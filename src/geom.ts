import type { Vec, Vertex, PathEnt, WallProps } from './types';

export const v = (x: number, y: number): Vec => ({ x, y });
export const add = (a: Vec, b: Vec): Vec => ({ x: a.x + b.x, y: a.y + b.y });
export const sub = (a: Vec, b: Vec): Vec => ({ x: a.x - b.x, y: a.y - b.y });
export const mul = (a: Vec, s: number): Vec => ({ x: a.x * s, y: a.y * s });
export const dot = (a: Vec, b: Vec): number => a.x * b.x + a.y * b.y;
export const cross = (a: Vec, b: Vec): number => a.x * b.y - a.y * b.x;
export const len = (a: Vec): number => Math.hypot(a.x, a.y);
export const dist = (a: Vec, b: Vec): number => Math.hypot(a.x - b.x, a.y - b.y);
export const lerp = (a: Vec, b: Vec, t: number): Vec => ({
  x: a.x + (b.x - a.x) * t,
  y: a.y + (b.y - a.y) * t,
});

export function norm(a: Vec): Vec {
  const l = len(a);
  return l < 1e-9 ? { x: 1, y: 0 } : { x: a.x / l, y: a.y / l };
}

/** Perpendicular (rotate +90° in SVG's y-down coords). */
export const perp = (a: Vec): Vec => ({ x: -a.y, y: a.x });

export function rotate(a: Vec, deg: number): Vec {
  const r = (deg * Math.PI) / 180;
  const c = Math.cos(r);
  const s = Math.sin(r);
  return { x: a.x * c - a.y * s, y: a.x * s + a.y * c };
}

export function rotateAround(p: Vec, center: Vec, deg: number): Vec {
  return add(center, rotate(sub(p, center), deg));
}

/** Closest point on segment ab to p. Returns param t in [0,1], point q and distance. */
export function pointSeg(p: Vec, a: Vec, b: Vec): { t: number; q: Vec; d: number } {
  const ab = sub(b, a);
  const l2 = dot(ab, ab);
  const t = l2 < 1e-12 ? 0 : Math.max(0, Math.min(1, dot(sub(p, a), ab) / l2));
  const q = add(a, mul(ab, t));
  return { t, q, d: dist(p, q) };
}

export interface BBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export function bboxOf(pts: Vec[]): BBox {
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const p of pts) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  return { minX, minY, maxX, maxY };
}

export function bboxUnion(a: BBox, b: BBox): BBox {
  return {
    minX: Math.min(a.minX, b.minX),
    minY: Math.min(a.minY, b.minY),
    maxX: Math.max(a.maxX, b.maxX),
    maxY: Math.max(a.maxY, b.maxY),
  };
}

export function bboxPad(b: BBox, p: number): BBox {
  return { minX: b.minX - p, minY: b.minY - p, maxX: b.maxX + p, maxY: b.maxY + p };
}

export function bboxIntersects(a: BBox, b: BBox): boolean {
  return a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY;
}

export function bboxContains(a: BBox, p: Vec): boolean {
  return p.x >= a.minX && p.x <= a.maxX && p.y >= a.minY && p.y <= a.maxY;
}

/** Shoelace area (absolute), cm². */
export function polygonArea(pts: Vec[]): number {
  let s = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    s += a.x * b.y - b.x * a.y;
  }
  return Math.abs(s) / 2;
}

export function pointInPolygon(pts: Vec[], p: Vec): boolean {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i];
    const b = pts[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x)
      inside = true;
  }
  return inside;
}

/**
 * Offset a polyline by distance d along vertex normals (miter joins).
 * Positive d offsets toward perp(direction). Corner radii are preserved.
 */
export function offsetPolyline(vts: Vertex[], d: number, closed: boolean): Vertex[] {
  const n = vts.length;
  if (n < 2 || Math.abs(d) < 1e-9) return vts.map((p) => ({ ...p }));
  const out: Vertex[] = [];
  for (let i = 0; i < n; i++) {
    const prev = vts[(i - 1 + n) % n];
    const next = vts[(i + 1) % n];
    const cur = vts[i];
    const hasIn = closed || i > 0;
    const hasOut = closed || i < n - 1;
    const nIn = hasIn ? perp(norm(sub(cur, prev))) : null;
    const nOut = hasOut ? perp(norm(sub(next, cur))) : null;
    let m: Vec;
    let scale = d;
    if (nIn && nOut) {
      const sum = add(nIn, nOut);
      if (len(sum) < 1e-6) {
        m = nIn; // 180° reversal; degenerate, fall back
      } else {
        m = norm(sum);
        const denom = dot(m, nIn);
        scale = d / Math.max(Math.abs(denom), 0.1) * Math.sign(denom || 1);
        // miter limit to avoid spikes on very sharp corners
        const lim = Math.abs(d) * 6;
        if (Math.abs(scale) > lim) scale = lim * Math.sign(scale);
      }
    } else {
      m = (nIn ?? nOut)!;
    }
    out.push({ x: cur.x + m.x * scale, y: cur.y + m.y * scale, r: cur.r });
  }
  return out;
}

interface CornerArc {
  p1: Vec; // arc start (on incoming segment)
  p2: Vec; // arc end (on outgoing segment)
  r: number;
  sweep: 0 | 1;
  center: Vec;
}

/** Compute the rounding arc for vertex i of a path, or null if not rounded/applicable. */
export function cornerArc(vts: Vertex[], i: number, closed: boolean): CornerArc | null {
  const n = vts.length;
  const cur = vts[i];
  if (!cur.r || cur.r <= 0) return null;
  if (!closed && (i === 0 || i === n - 1)) return null;
  const prev = vts[(i - 1 + n) % n];
  const next = vts[(i + 1) % n];
  const dIn = norm(sub(cur, prev));
  const dOut = norm(sub(next, cur));
  const crossSign = cross(dIn, dOut);
  if (Math.abs(crossSign) < 1e-6) return null; // collinear, nothing to round
  // interior angle between the two segments at the corner
  const cosA = -dot(dIn, dOut);
  const ang = Math.acos(Math.max(-1, Math.min(1, cosA)));
  const tanHalf = Math.tan(ang / 2);
  if (tanHalf < 1e-6) return null;
  let trim = cur.r / tanHalf;
  // clamp so the arc never eats more than ~48% of either adjacent segment
  const maxTrim = 0.48 * Math.min(dist(prev, cur), dist(cur, next));
  let r = cur.r;
  if (trim > maxTrim) {
    trim = maxTrim;
    r = trim * tanHalf;
  }
  const p1 = sub(cur, mul(dIn, trim));
  const p2 = add(cur, mul(dOut, trim));
  const side = Math.sign(crossSign);
  const center = add(p1, mul(perp(dIn), r * side));
  return { p1, p2, r, sweep: side > 0 ? 1 : 0, center };
}

/** SVG path `d` for a path with per-vertex corner rounding. */
export function pathD(vts: Vertex[], closed: boolean): string {
  const n = vts.length;
  if (n === 0) return '';
  if (n === 1) return `M ${fx(vts[0].x)} ${fx(vts[0].y)}`;
  const parts: string[] = [];
  const arcs: (CornerArc | null)[] = vts.map((_, i) => cornerArc(vts, i, closed));
  const startPt = arcs[0] ? arcs[0].p2 : vts[0];
  parts.push(`M ${fx(startPt.x)} ${fx(startPt.y)}`);
  const last = closed ? n : n - 1;
  for (let k = 1; k <= last; k++) {
    const i = k % n;
    const a = arcs[i];
    if (a) {
      parts.push(`L ${fx(a.p1.x)} ${fx(a.p1.y)}`);
      parts.push(`A ${fx(a.r)} ${fx(a.r)} 0 0 ${a.sweep} ${fx(a.p2.x)} ${fx(a.p2.y)}`);
    } else if (closed && k === last) {
      // closing back to start handled by Z
    } else {
      parts.push(`L ${fx(vts[i].x)} ${fx(vts[i].y)}`);
    }
  }
  if (closed) parts.push('Z');
  return parts.join(' ');
}

const fx = (x: number) => (Math.round(x * 100) / 100).toString();

/** Flatten a rounded path to plain points (arcs sampled), for area/bbox/hit-tests. */
export function flattenPath(vts: Vertex[], closed: boolean): Vec[] {
  const n = vts.length;
  const out: Vec[] = [];
  for (let i = 0; i < n; i++) {
    const a = cornerArc(vts, i, closed);
    if (!a) {
      out.push({ x: vts[i].x, y: vts[i].y });
      continue;
    }
    const a0 = Math.atan2(a.p1.y - a.center.y, a.p1.x - a.center.x);
    let a1 = Math.atan2(a.p2.y - a.center.y, a.p2.x - a.center.x);
    if (a.sweep === 1 && a1 < a0) a1 += Math.PI * 2;
    if (a.sweep === 0 && a1 > a0) a1 -= Math.PI * 2;
    const steps = Math.max(2, Math.ceil(Math.abs(a1 - a0) / (Math.PI / 12)));
    for (let s = 0; s <= steps; s++) {
      const t = a0 + ((a1 - a0) * s) / steps;
      out.push({ x: a.center.x + Math.cos(t) * a.r, y: a.center.y + Math.sin(t) * a.r });
    }
  }
  return out;
}

/** Path length along segments (rounding ignored — reference-line length). */
export function polylineLength(vts: Vec[], closed: boolean): number {
  let s = 0;
  for (let i = 0; i < vts.length - 1; i++) s += dist(vts[i], vts[i + 1]);
  if (closed && vts.length > 2) s += dist(vts[vts.length - 1], vts[0]);
  return s;
}

// ---- Wall helpers -------------------------------------------------------

/** Perpendicular offsets (in multiples applied via offsetPolyline) for a wall. */
export function wallOffsets(w: WallProps): { center: number; faceA: number; faceB: number } {
  if (w.align === 'center') return { center: 0, faceA: -w.thickness / 2, faceB: w.thickness / 2 };
  return { center: (w.side * w.thickness) / 2, faceA: 0, faceB: w.side * w.thickness };
}

/** Rendered centerline of a wall path (reference line offset by align/side). */
export function wallCenterline(p: PathEnt): Vertex[] {
  if (!p.wall) return p.vertices;
  const off = wallOffsets(p.wall).center;
  return offsetPolyline(p.vertices, off, p.closed);
}

/** Both wall faces as polylines (unrounded corners are fine for snapping). */
export function wallFaces(p: PathEnt): Vertex[][] {
  if (!p.wall) return [];
  const o = wallOffsets(p.wall);
  return [
    offsetPolyline(p.vertices, o.faceA, p.closed),
    offsetPolyline(p.vertices, o.faceB, p.closed),
  ];
}

/** The face polygon with the smaller enclosed area = the inner face (room side). */
export function wallInnerFace(p: PathEnt): Vertex[] {
  const faces = wallFaces(p);
  if (faces.length === 0) return p.vertices;
  const a0 = polygonArea(flattenPath(faces[0], true));
  const a1 = polygonArea(flattenPath(faces[1], true));
  return a0 <= a1 ? faces[0] : faces[1];
}

/** Snap an angle (radians) to the nearest step (degrees). */
export function snapAngleRad(ang: number, stepDeg: number): number {
  const step = (stepDeg * Math.PI) / 180;
  return Math.round(ang / step) * step;
}

/** `precision` is the number of decimal digits shown; omit to keep the fixed display used everywhere except configurable measuring tools. */
export function formatLen(cm: number, unit: 'm' | 'cm', precision?: number): string {
  if (unit === 'cm') {
    const f = 10 ** (precision ?? 1);
    return `${Math.round(cm * f) / f} cm`;
  }
  return `${(cm / 100).toFixed(precision ?? 2)} m`;
}

export function formatArea(cm2: number): string {
  return `${(cm2 / 10000).toFixed(2)} m²`;
}

/** Parse user length input in the current unit; returns cm or null. */
export function parseLen(s: string, unit: 'm' | 'cm'): number | null {
  const t = s.trim().replace(',', '.');
  if (!t) return null;
  const m = t.match(/^(-?\d*\.?\d+)\s*(m|cm|mm)?$/i);
  if (!m) return null;
  const val = parseFloat(m[1]);
  if (!isFinite(val)) return null;
  const u = (m[2] || unit).toLowerCase();
  if (u === 'cm') return val;
  if (u === 'mm') return val / 10;
  return val * 100;
}
