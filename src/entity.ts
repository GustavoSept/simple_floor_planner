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
  const center = wallCenterline(wall);
  const n = center.length;
  if (o.seg < 0 || o.seg >= (wall.closed ? n : n - 1)) return null;
  const a = center[o.seg];
  const b = center[(o.seg + 1) % n];
  const segLen = dist(a, b);
  if (segLen < 1) return null;
  const dir = norm(sub(b, a));
  const t = Math.max(o.width / 2, Math.min(segLen - o.width / 2, o.t));
  const c = add(a, mul(dir, t));
  return { c, dir, n: perp(dir), thickness: wall.wall.thickness, segA: a, segB: b };
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
      const hw = e.width / 2;
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
