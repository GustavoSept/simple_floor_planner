import type { Doc, Settings, Vec } from './types';
import { add, dist, dot, mul, norm, pointSeg, snapAngleRad, sub } from './geom';
import { snapEdges, snapVertices } from './entity';

export interface SnapHit {
  p: Vec;
  kind: 'vertex' | 'edge' | 'grid' | 'free';
  entId?: string;
}

export interface SnapOpts {
  exclude?: ReadonlySet<string>;
  /** disable all snapping (e.g. Ctrl held) */
  off?: boolean;
}

/** Snap a free point: object vertices > object edges > grid. */
export function snapPoint(
  doc: Doc,
  w: Vec,
  tol: number,
  s: Settings,
  opts: SnapOpts = {},
): SnapHit {
  if (opts.off) return { p: w, kind: 'free' };
  if (s.snapObjects) {
    let best: SnapHit | null = null;
    let bestD = tol;
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
    if (best) return best;
    // edges
    let bestE: SnapHit | null = null;
    let bestED = tol;
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

/** Place a point at an exact typed distance from anchor, toward `toward`. */
export function pointAtDistance(anchor: Vec, toward: Vec, lenCm: number, angleSnap: boolean): Vec {
  let dir = norm(sub(toward, anchor));
  if (angleSnap) {
    const ang = snapAngleRad(Math.atan2(dir.y, dir.x), 15);
    dir = { x: Math.cos(ang), y: Math.sin(ang) };
  }
  return add(anchor, mul(dir, lenCm));
}
