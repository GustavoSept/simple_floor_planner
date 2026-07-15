import type { Doc, Entity, ItemEnt, OpeningEnt, PathEnt, Vec, Vertex } from './types';
import {
  add,
  bboxOf,
  bboxPad,
  bboxUnion,
  cross,
  dist,
  flattenPath,
  mul,
  norm,
  perp,
  pointSeg,
  rotateAround,
  sub,
  wallCenterline,
  wallFaces,
  type BBox,
} from './geom';

export function itemCorners(it: ItemEnt): Vec[] {
  const hw = it.w / 2;
  const hh = it.h / 2;
  const c = { x: it.x, y: it.y };
  return [
    { x: -hw, y: -hh },
    { x: hw, y: -hh },
    { x: hw, y: hh },
    { x: -hw, y: hh },
  ].map((p) => rotateAround(add(c, p), c, it.rotation));
}

/** Door leaf width plus its frame ("batente") padding on both sides; windows have no padding. */
export function openingTotalWidth(o: OpeningEnt): number {
  return o.width + (o.opening === 'door' ? (o.padding ?? 0) * 2 : 0);
}

export interface OpeningGeom {
  c: Vec; // opening center on the wall centerline
  dir: Vec; // unit vector along the wall segment
  n: Vec; // unit normal
  thickness: number;
  segA: Vec;
  segB: Vec;
}

export function openingGeom(doc: Doc, o: OpeningEnt): OpeningGeom | null {
  const wall = doc.entities.find((e) => e.id === o.wallId);
  if (!wall || wall.kind !== 'path' || !wall.wall) return null;
  return openingGeomOn(wall, o);
}

/** Opening geometry against a resolved wall (bypasses the doc id lookup). */
export function openingGeomOn(wall: PathEnt, o: OpeningEnt): OpeningGeom | null {
  if (!wall.wall) return null;
  const center = wallCenterline(wall);
  const n = center.length;
  if (o.seg < 0 || o.seg >= (wall.closed ? n : n - 1)) return null;
  const a = center[o.seg];
  const b = center[(o.seg + 1) % n];
  const segLen = dist(a, b);
  if (segLen < 1) return null;
  const dir = norm(sub(b, a));
  const half = openingTotalWidth(o) / 2;
  const t = Math.max(half, Math.min(segLen - half, o.t));
  const c = add(a, mul(dir, t));
  return { c, dir, n: perp(dir), thickness: wall.wall.thickness, segA: a, segB: b };
}

/** The (seg, t) on a wall's centerline whose point is closest to world point `c`. */
export function anchorOnWall(wall: PathEnt, c: Vec): { seg: number; t: number } {
  const center = wallCenterline(wall);
  const n = center.length;
  const last = wall.closed ? n : n - 1;
  let best = { seg: 0, t: 0, d: Infinity };
  for (let i = 0; i < last; i++) {
    const a = center[i];
    const b = center[(i + 1) % n];
    const r = pointSeg(c, a, b);
    if (r.d < best.d) best = { seg: i, t: r.t * dist(a, b), d: r.d };
  }
  return { seg: best.seg, t: Math.round(best.t) };
}

/**
 * Replace a wall path's vertices, re-anchoring every opening on that wall so it
 * keeps its physical position. Openings reference wall segments by index, so a
 * bare vertex insert/delete shifts them onto the wrong segment — they must be
 * re-anchored against the wall's world geometry, or the plan (and any file
 * saved from it) ends up with doors/windows in the wrong place.
 */
export function setWallVertices(entities: Entity[], wallId: string, vertices: Vertex[]): Entity[] {
  const wall = entities.find((e) => e.id === wallId);
  if (!wall || wall.kind !== 'path') return entities;
  const newWall: PathEnt = { ...wall, vertices };
  // Capture each opening's world center against the OLD geometry first.
  const centers = new Map<string, Vec>();
  if (wall.wall) {
    for (const e of entities) {
      if (e.kind !== 'opening' || e.wallId !== wallId) continue;
      const g = openingGeomOn(wall, e);
      if (g) centers.set(e.id, g.c);
    }
  }
  return entities.map((e) => {
    if (e.id === wallId) return newWall;
    if (e.kind !== 'opening' || e.wallId !== wallId || !newWall.wall) return e;
    const c = centers.get(e.id);
    if (!c) return e;
    return { ...e, ...anchorOnWall(newWall, c) };
  });
}

/** All points that outline a path entity (incl. wall faces), flattened. */
export function pathOutlinePoints(p: PathEnt): Vec[] {
  if (!p.wall) return flattenPath(p.vertices, p.closed);
  const pts: Vec[] = [];
  for (const face of wallFaces(p)) pts.push(...flattenPath(face, p.closed));
  return pts;
}

export function entityBBox(doc: Doc, e: Entity): BBox | null {
  switch (e.kind) {
    case 'path': {
      const pts = pathOutlinePoints(e);
      return pts.length ? bboxOf(pts) : null;
    }
    case 'item':
      return bboxOf(itemCorners(e));
    case 'opening': {
      const g = openingGeom(doc, e);
      if (!g) return null;
      const hw = openingTotalWidth(e) / 2;
      const ht = g.thickness / 2;
      const ext = e.opening === 'door' ? e.width : ht;
      return bboxOf([
        add(add(g.c, mul(g.dir, hw)), mul(g.n, ext)),
        add(add(g.c, mul(g.dir, hw)), mul(g.n, -ext)),
        add(add(g.c, mul(g.dir, -hw)), mul(g.n, ext)),
        add(add(g.c, mul(g.dir, -hw)), mul(g.n, -ext)),
      ]);
    }
    case 'dim': {
      const d = norm(sub(e.b, e.a));
      const off = mul(perp(d), e.offset);
      return bboxOf([e.a, e.b, add(e.a, off), add(e.b, off)]);
    }
    case 'angle': {
      const r = e.radius;
      return bboxOf([
        e.vertex,
        e.a,
        e.b,
        { x: e.vertex.x - r, y: e.vertex.y - r },
        { x: e.vertex.x + r, y: e.vertex.y + r },
      ]);
    }
    case 'text': {
      const w = Math.max(20, e.text.length * e.size * 0.6);
      return { minX: e.x, minY: e.y - e.size, maxX: e.x + w, maxY: e.y + e.size * 0.3 };
    }
    case 'arealabel':
      return bboxPad(bboxOf([{ x: e.x, y: e.y }]), 40);
  }
}

export function docBBox(doc: Doc): BBox | null {
  let b: BBox | null = null;
  for (const e of doc.entities) {
    const eb = entityBBox(doc, e);
    if (!eb) continue;
    b = b ? bboxUnion(b, eb) : eb;
  }
  return b;
}

/** Translate an entity. Openings are wall-relative and don't translate on their own. */
export function moveEntity(e: Entity, d: Vec): Entity {
  switch (e.kind) {
    case 'path':
      return { ...e, vertices: e.vertices.map((p) => ({ ...p, x: p.x + d.x, y: p.y + d.y })) };
    case 'item':
    case 'text':
    case 'arealabel':
      return { ...e, x: e.x + d.x, y: e.y + d.y };
    case 'dim':
      return { ...e, a: add(e.a, d), b: add(e.b, d) };
    case 'angle':
      return { ...e, vertex: add(e.vertex, d), a: add(e.a, d), b: add(e.b, d) };
    case 'opening':
      return e;
  }
}

/** Rotate an entity around a center by deg. Openings follow their wall; skip. */
export function rotateEntity(e: Entity, center: Vec, deg: number): Entity {
  const rot = (p: Vec) => rotateAround(p, center, deg);
  switch (e.kind) {
    case 'path':
      return { ...e, vertices: e.vertices.map((p) => ({ ...rot(p), r: p.r })) };
    case 'item': {
      const c = rot({ x: e.x, y: e.y });
      return { ...e, x: c.x, y: c.y, rotation: (e.rotation + deg) % 360 };
    }
    case 'text':
    case 'arealabel': {
      const c = rot({ x: e.x, y: e.y });
      return { ...e, x: c.x, y: c.y };
    }
    case 'dim':
      return { ...e, a: rot(e.a), b: rot(e.b) };
    case 'angle':
      return { ...e, vertex: rot(e.vertex), a: rot(e.a), b: rot(e.b) };
    case 'opening':
      return e;
  }
}

export interface WallPlacement {
  wall: PathEnt;
  seg: number;
  t: number; // cm along the segment from its start
  q: Vec; // projected point on the centerline
  d: number; // distance from the query point
  side: 1 | -1; // which side of the centerline the query point is on
}

/** Nearest wall segment (centerline) to a point, or null if none within reach. */
export function nearestWallPlacement(doc: Doc, p: Vec, extraTol: number): WallPlacement | null {
  let best: WallPlacement | null = null;
  for (const e of doc.entities) {
    if (e.kind !== 'path' || !e.wall) continue;
    const l = doc.layers[e.layer];
    if (!l?.visible || l.locked) continue;
    const center = wallCenterline(e);
    const n = center.length;
    const last = e.closed ? n : n - 1;
    for (let i = 0; i < last; i++) {
      const a = center[i];
      const b = center[(i + 1) % n];
      const r = pointSeg(p, a, b);
      const reach = e.wall.thickness / 2 + extraTol;
      if (r.d <= reach && (!best || r.d < best.d)) {
        const dir = norm(sub(b, a));
        const side = cross(dir, sub(p, r.q)) >= 0 ? 1 : -1;
        best = { wall: e, seg: i, t: r.t * dist(a, b), q: r.q, d: r.d, side };
      }
    }
  }
  return best;
}

/** Vertices to snap to for an entity (path refs + wall face corners). */
export function snapVertices(p: PathEnt): Vertex[] {
  if (!p.wall) return p.vertices;
  const [fa, fb] = wallFaces(p);
  return [...fa, ...fb];
}

/** Edges (pairs) to snap to. */
export function snapEdges(p: PathEnt): [Vec, Vec][] {
  const out: [Vec, Vec][] = [];
  const lines: Vertex[][] = p.wall ? wallFaces(p) : [p.vertices];
  for (const line of lines) {
    const n = line.length;
    const last = p.closed ? n : n - 1;
    for (let i = 0; i < last; i++) out.push([line[i], line[(i + 1) % n]]);
  }
  return out;
}
