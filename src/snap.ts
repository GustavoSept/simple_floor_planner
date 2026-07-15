import type { DimEnt, Doc, Settings, Vec } from './types';
import { add, dist, dot, mul, norm, pointSeg, snapAngleRad, sub } from './geom';
import { snapEdges, snapVertices } from './entity';

export interface SnapHit {
  p: Vec;
  kind: 'vertex' | 'edge' | 'grid' | 'free';
  entId?: string;
  /** set when snapped to a dimension line (measurement snap): the rendered line to highlight */
  guide?: [Vec, Vec];
}

export interface SnapOpts {
  exclude?: ReadonlySet<string>;
  /** disable all snapping (e.g. Ctrl held) */
  off?: boolean;
  /** id of a previously-snapped dimension line; grants it a wider catch radius so
   * the snap doesn't flicker between nearby lines while sliding along one of them */
  sticky?: string;
}

/** The straight line between the dimension's two measured points (not the offset line it's drawn on). */
function dimLine(e: DimEnt): [Vec, Vec] {
  return [e.a, e.b];
}

/** Nearest snap candidate on one dimension line; `mode` gates whether the segment (not just its ends) counts. */
function dimCandidate(e: DimEnt, mode: 'vertex' | 'all', w: Vec): { hit: SnapHit; d: number } | null {
  const [A, B] = dimLine(e);
  let bestD = Infinity;
  let bestP = A;
  let bestKind: 'vertex' | 'edge' = 'vertex';
  for (const p of [A, B]) {
    const d = dist(w, p);
    if (d < bestD) {
      bestD = d;
      bestP = p;
      bestKind = 'vertex';
    }
  }
  if (mode === 'all') {
    const r = pointSeg(w, A, B);
    if (r.d < bestD) {
      bestD = r.d;
      bestP = r.q;
      bestKind = 'edge';
    }
  }
  return { hit: { p: { x: bestP.x, y: bestP.y }, kind: bestKind, entId: e.id, guide: [A, B] }, d: bestD };
}

const STICKY_MULT = 1.6;

/** Snap a free point: object vertices > object/measurement edges > grid. */
export function snapPoint(
  doc: Doc,
  w: Vec,
  tol: number,
  s: Settings,
  opts: SnapOpts = {},
): SnapHit {
  if (opts.off) return { p: w, kind: 'free' };
  if (s.measureSnap !== 'off' && opts.sticky) {
    const e = doc.entities.find((x) => x.id === opts.sticky);
    if (e && e.kind === 'dim' && doc.layers[e.layer]?.visible && !opts.exclude?.has(e.id)) {
      const c = dimCandidate(e, s.measureSnap === 'all' ? 'all' : 'vertex', w);
      if (c && c.d < tol * STICKY_MULT) return c.hit;
    }
  }
  if (s.snapObjects || s.measureSnap !== 'off') {
    let best: SnapHit | null = null;
    let bestD = tol;
    if (s.snapObjects) {
      for (const e of doc.entities) {
        if (e.kind !== 'path') continue;
        if (opts.exclude?.has(e.id)) continue;
        if (!doc.layers[e.layer]?.visible) continue;
        for (const p of snapVertices(e)) {
          const d = dist(w, p);
          if (d < bestD) {
            bestD = d;
            best = { p: { x: p.x, y: p.y }, kind: 'vertex', entId: e.id };
          }
        }
      }
    }
    if (s.measureSnap !== 'off') {
      for (const e of doc.entities) {
        if (e.kind !== 'dim') continue;
        if (opts.exclude?.has(e.id)) continue;
        if (!doc.layers[e.layer]?.visible) continue;
        const [A, B] = dimLine(e);
        for (const p of [A, B]) {
          const d = dist(w, p);
          if (d < bestD) {
            bestD = d;
            best = { p: { x: p.x, y: p.y }, kind: 'vertex', entId: e.id, guide: [A, B] };
          }
        }
      }
    }
    if (best) return best;
    // edges
    let bestE: SnapHit | null = null;
    let bestED = tol;
    if (s.snapObjects) {
      for (const e of doc.entities) {
        if (e.kind !== 'path') continue;
        if (opts.exclude?.has(e.id)) continue;
        if (!doc.layers[e.layer]?.visible) continue;
        for (const [a, b] of snapEdges(e)) {
          const r = pointSeg(w, a, b);
          if (r.d < bestED) {
            bestED = r.d;
            bestE = { p: r.q, kind: 'edge', entId: e.id };
          }
        }
      }
    }
    if (s.measureSnap === 'all') {
      for (const e of doc.entities) {
        if (e.kind !== 'dim') continue;
        if (opts.exclude?.has(e.id)) continue;
        if (!doc.layers[e.layer]?.visible) continue;
        const [A, B] = dimLine(e);
        const r = pointSeg(w, A, B);
        if (r.d < bestED) {
          bestED = r.d;
          bestE = { p: r.q, kind: 'edge', entId: e.id, guide: [A, B] };
        }
      }
    }
    if (bestE) {
      // snap the projected point to grid along the edge? keep it simple: raw projection
      return bestE;
    }
  }
  if (s.snapGrid && s.gridSize > 0) {
    const g = s.gridSize;
    return {
      p: { x: Math.round(w.x / g) * g, y: Math.round(w.y / g) * g },
      kind: 'grid',
    };
  }
  return { p: w, kind: 'free' };
}

/**
 * Snap for the next point while drawing from `anchor`:
 * object snap wins; otherwise constrain to 15° increments (if enabled),
 * rounding the distance to the grid step along the ray.
 */
export function snapDraw(
  doc: Doc,
  anchor: Vec,
  w: Vec,
  tol: number,
  s: Settings,
  opts: SnapOpts = {},
): SnapHit {
  if (opts.off) return { p: w, kind: 'free' };
  if (s.snapObjects) {
    const hit = snapPoint(doc, w, tol, { ...s, snapGrid: false }, opts);
    if (hit.kind === 'vertex' || hit.kind === 'edge') return hit;
  }
  if (s.snapAngle) {
    const d = sub(w, anchor);
    const ang = snapAngleRad(Math.atan2(d.y, d.x), 15);
    const dir = { x: Math.cos(ang), y: Math.sin(ang) };
    let l = dot(d, dir);
    if (s.snapGrid && s.gridSize > 0) l = Math.round(l / s.gridSize) * s.gridSize;
    return { p: add(anchor, mul(dir, l)), kind: 'grid' };
  }
  return snapPoint(doc, w, tol, s, opts);
}

/**
 * Snap while repositioning an existing point (dragging a wall vertex, a
 * dimension endpoint, a whole selection, ...). When `axis` is set (Shift
 * held), the point is locked to the horizontal or vertical line through
 * `anchor` — whichever axis the drag is predominantly moving along — with
 * grid snapping still applied along the free axis. Object/grid snapping is
 * unconstrained otherwise.
 */
export function snapMove(
  doc: Doc,
  anchor: Vec,
  w: Vec,
  tol: number,
  s: Settings,
  axis: boolean,
  opts: SnapOpts = {},
): SnapHit {
  if (opts.off) return { p: axis ? axisLock(anchor, w) : w, kind: 'free' };
  if (axis) {
    const horiz = Math.abs(w.x - anchor.x) >= Math.abs(w.y - anchor.y);
    let x = horiz ? w.x : anchor.x;
    let y = horiz ? anchor.y : w.y;
    if (s.snapGrid && s.gridSize > 0) {
      const g = s.gridSize;
      if (horiz) x = Math.round(x / g) * g;
      else y = Math.round(y / g) * g;
    }
    return { p: { x, y }, kind: 'grid' };
  }
  return snapPoint(doc, w, tol, s, opts);
}

function axisLock(anchor: Vec, p: Vec): Vec {
  const horiz = Math.abs(p.x - anchor.x) >= Math.abs(p.y - anchor.y);
  return horiz ? { x: p.x, y: anchor.y } : { x: anchor.x, y: p.y };
}

export interface AlignGuide {
  axis: 'x' | 'y'; // which coordinate was locked (x -> a vertical guide line, y -> horizontal)
  value: number;
}

/**
 * Reference vertices from the same object eligible for X/Y alignment,
 * filtered by topological hop distance from `idx` along the vertex chain
 * (wrapping for closed paths). `idx` may be one past the end (vertices.length)
 * to mean "the point about to be appended while drawing".
 */
export function alignRefVertices(
  vertices: Vec[],
  idx: number,
  closed: boolean,
  mode: 'immediate' | 'close' | 'all',
): Vec[] {
  const n = vertices.length;
  if (mode === 'all') return vertices.filter((_, i) => i !== idx);
  const maxHop = mode === 'immediate' ? 1 : 4;
  const out: Vec[] = [];
  for (let i = 0; i < n; i++) {
    if (i === idx) continue;
    const diff = Math.abs(i - idx);
    const hop = closed ? Math.min(diff, n - diff) : diff;
    if (hop <= maxHop) out.push(vertices[i]);
  }
  return out;
}

/** Snap `p`'s X and/or Y independently onto the nearest reference vertex within `tol`. */
export function alignSnap(p: Vec, refs: Vec[], tol: number): { p: Vec; guides: AlignGuide[] } {
  let bestX: { d: number; v: number } | null = null;
  let bestY: { d: number; v: number } | null = null;
  for (const r of refs) {
    const dx = Math.abs(p.x - r.x);
    if (dx < tol && (!bestX || dx < bestX.d)) bestX = { d: dx, v: r.x };
    const dy = Math.abs(p.y - r.y);
    if (dy < tol && (!bestY || dy < bestY.d)) bestY = { d: dy, v: r.y };
  }
  const guides: AlignGuide[] = [];
  if (bestX) guides.push({ axis: 'x', value: bestX.v });
  if (bestY) guides.push({ axis: 'y', value: bestY.v });
  return { p: { x: bestX ? bestX.v : p.x, y: bestY ? bestY.v : p.y }, guides };
}

/** Place a point at an exact typed distance from anchor, toward `toward`. */
export function pointAtDistance(anchor: Vec, toward: Vec, lenCm: number, angleSnap: boolean): Vec {
  let dir = norm(sub(toward, anchor));
  if (angleSnap) {
    const ang = snapAngleRad(Math.atan2(dir.y, dir.x), 15);
    dir = { x: Math.cos(ang), y: Math.sin(ang) };
  }
  return add(anchor, mul(dir, lenCm));
}
