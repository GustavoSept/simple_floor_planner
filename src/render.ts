import type {
  AngleEnt,
  AreaLabelEnt,
  DimEnt,
  Doc,
  ItemEnt,
  LayerId,
  OpeningEnt,
  PathEnt,
  TextEnt,
} from './types';
import { LAYER_ORDER } from './types';
import {
  add,
  angleBetweenDeg,
  dist,
  flattenPath,
  formatArea,
  formatLen,
  lerp,
  mul,
  norm,
  pathD,
  perp,
  polygonArea,
  sub,
  wallCenterline,
  wallInnerFace,
  type BBox,
} from './geom';
import { openingGeom, openingTotalWidth } from './entity';
import { SYMBOLS } from './symbols';
import type { ViewState } from './view';

export const SVG_NS = 'http://www.w3.org/2000/svg';

export function el<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | number> = {},
  ...children: (SVGElement | string)[]
): SVGElementTagNameMap[K] {
  const e = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  for (const c of children) {
    if (typeof c === 'string') e.appendChild(document.createTextNode(c));
    else e.appendChild(c);
  }
  return e;
}

export interface Palette {
  paper: string;
  ink: string;
  wall: string;
  furniture: string;
  dim: string;
  annot: string;
  electrical: string;
  plumbing: string;
  muted: string;
  gridMinor: string;
  gridMajor: string;
}

export const LIGHT_PALETTE: Palette = {
  paper: '#f6f5f0',
  ink: '#35342e',
  wall: '#3a3831',
  furniture: '#6f6d64',
  dim: '#976f34',
  annot: '#45443d',
  electrical: '#a16207',
  plumbing: '#3e6f9e',
  muted: '#9b9a90',
  gridMinor: 'rgba(60,58,49,0.07)',
  gridMajor: 'rgba(60,58,49,0.16)',
};

export const DARK_PALETTE: Palette = {
  paper: '#181a1e',
  ink: '#d9d7cc',
  wall: '#cfcdc0',
  furniture: '#93917f',
  dim: '#c39b5c',
  annot: '#bdbbaf',
  electrical: '#d3a75c',
  plumbing: '#77a5d2',
  muted: '#70706a',
  gridMinor: 'rgba(217,215,204,0.06)',
  gridMajor: 'rgba(217,215,204,0.14)',
};

export const PRINT_PALETTE: Palette = {
  ...LIGHT_PALETTE,
  paper: '#ffffff',
  ink: '#222222',
  wall: '#262626',
  furniture: '#555555',
  dim: '#444444',
  annot: '#333333',
  electrical: '#444444',
  plumbing: '#444444',
  muted: '#777777',
  gridMinor: 'none',
  gridMajor: 'none',
};

export interface RenderOpts {
  palette: Palette;
  unit: 'm' | 'cm';
  interactive: boolean;
}

function layerColor(p: Palette, layer: LayerId): string {
  switch (layer) {
    case 'structure':
      return p.ink;
    case 'furniture':
      return p.furniture;
    case 'dimensions':
      return p.dim;
    case 'annotations':
      return p.annot;
    case 'electrical':
      return p.electrical;
    case 'plumbing':
      return p.plumbing;
  }
}

export const FONT = 'system-ui, "Segoe UI", sans-serif';

/** Build the full document scene as an SVG group (fresh each call). */
export function buildScene(doc: Doc, o: RenderOpts): SVGGElement {
  const root = el('g', { 'font-family': FONT });
  for (const layer of LAYER_ORDER) {
    if (!doc.layers[layer]?.visible) continue;
    const g = el('g', { 'data-layer': layer });
    const ents = doc.entities.filter((e) => e.layer === layer);
    // walls first, then openings (which punch holes), then everything else
    const order = (e: Doc['entities'][number]) =>
      e.kind === 'path' && e.wall ? 0 : e.kind === 'opening' ? 1 : 2;
    ents.sort((a, b) => order(a) - order(b));
    for (const e of ents) {
      let node: SVGGElement | null = null;
      switch (e.kind) {
        case 'path':
          node = buildPath(e, o);
          break;
        case 'opening':
          node = buildOpening(doc, e, o);
          break;
        case 'item':
          node = buildItem(doc, e, o);
          break;
        case 'dim':
          node = buildDim(e, o);
          break;
        case 'angle':
          node = buildAngle(e, o);
          break;
        case 'text':
          node = buildText(e, o);
          break;
        case 'arealabel':
          node = buildAreaLabel(doc, e, o);
          break;
      }
      if (node) {
        node.setAttribute('data-id', e.id);
        node.classList.add('ent');
        g.appendChild(node);
      }
    }
    root.appendChild(g);
  }
  return root;
}

function buildPath(e: PathEnt, o: RenderOpts): SVGGElement {
  const g = el('g');
  if (e.wall) {
    const center = wallCenterline(e);
    const d = pathD(center, e.closed);
    g.appendChild(
      el('path', {
        d,
        fill: 'none',
        stroke: o.palette.wall,
        'stroke-width': e.wall.thickness,
        'stroke-linejoin': 'miter',
        'stroke-linecap': 'butt',
        'stroke-miterlimit': 8,
      }),
    );
    if (o.interactive)
      g.appendChild(hitStroke(d, e.wall.thickness + 8));
  } else {
    const d = pathD(e.vertices, e.closed);
    g.appendChild(
      el('path', {
        d,
        fill: 'none',
        stroke: layerColor(o.palette, e.layer),
        'stroke-width': 1.6,
        'stroke-linejoin': 'round',
        'stroke-linecap': 'round',
      }),
    );
    if (o.interactive) g.appendChild(hitStroke(d, 12));
  }
  return g;
}

function hitStroke(d: string, width: number): SVGPathElement {
  return el('path', {
    d,
    fill: 'none',
    stroke: 'rgba(0,0,0,0)',
    'stroke-width': width,
    class: 'hit',
    'pointer-events': 'stroke',
  });
}

function buildOpening(doc: Doc, e: OpeningEnt, o: RenderOpts): SVGGElement | null {
  const g0 = openingGeom(doc, e);
  if (!g0) return null;
  const { c, dir, n, thickness } = g0;
  const hw = openingTotalWidth(e) / 2;
  const ht = thickness / 2 + 0.8;
  const g = el('g');
  const corner = (sd: number, sn: number) => add(add(c, mul(dir, sd * hw)), mul(n, sn * ht));
  const pts = [corner(-1, -1), corner(1, -1), corner(1, 1), corner(-1, 1)]
    .map((p) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`)
    .join(' ');
  // punch through the wall
  g.appendChild(
    el('polygon', { points: pts, fill: o.palette.paper, stroke: 'none', class: o.interactive ? 'hit' : '', 'pointer-events': o.interactive ? 'fill' : 'none' }),
  );
  const ink = o.palette.ink;
  const thin = { fill: 'none', stroke: ink, 'stroke-width': 1.4 } as const;
  // jamb lines across the wall at both ends
  for (const sd of [-1, 1] as const) {
    const a = add(add(c, mul(dir, sd * hw)), mul(n, -thickness / 2));
    const b = add(add(c, mul(dir, sd * hw)), mul(n, thickness / 2));
    g.appendChild(el('line', { x1: a.x, y1: a.y, x2: b.x, y2: b.y, ...thin }));
  }
  if (e.opening === 'window') {
    // sill outline + glass line
    const s1 = add(add(c, mul(dir, -hw)), mul(n, -thickness / 2));
    const s2 = add(add(c, mul(dir, hw)), mul(n, -thickness / 2));
    const s3 = add(add(c, mul(dir, hw)), mul(n, thickness / 2));
    const s4 = add(add(c, mul(dir, -hw)), mul(n, thickness / 2));
    g.appendChild(
      el('polygon', {
        points: [s1, s2, s3, s4].map((p) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(' '),
        fill: 'none',
        stroke: ink,
        'stroke-width': 1.2,
      }),
    );
    const m1 = add(c, mul(dir, -hw));
    const m2 = add(c, mul(dir, hw));
    g.appendChild(el('line', { x1: m1.x, y1: m1.y, x2: m2.x, y2: m2.y, ...thin }));
  } else {
    // door: leaf + swing arc, drawn from the face on the swing side
    const hingeC = add(c, mul(dir, (-e.hinge * e.width) / 2));
    const otherC = add(c, mul(dir, (e.hinge * e.width) / 2));
    const face = mul(n, (thickness / 2) * e.swing);
    const hinge = add(hingeC, face);
    const other = add(otherC, face);
    const tip = add(hinge, mul(n, e.width * e.swing));
    g.appendChild(el('line', { x1: hinge.x, y1: hinge.y, x2: tip.x, y2: tip.y, ...thin }));
    const sweep = (sub(other, hinge).x * sub(tip, hinge).y - sub(other, hinge).y * sub(tip, hinge).x) > 0 ? 1 : 0;
    g.appendChild(
      el('path', {
        d: `M ${other.x.toFixed(2)} ${other.y.toFixed(2)} A ${e.width} ${e.width} 0 0 ${sweep} ${tip.x.toFixed(2)} ${tip.y.toFixed(2)}`,
        fill: 'none',
        stroke: o.palette.muted,
        'stroke-width': 1,
        'stroke-dasharray': '4 3',
      }),
    );
  }
  return g;
}

function buildItem(doc: Doc, e: ItemEnt, o: RenderOpts): SVGGElement {
  const color = layerColor(o.palette, e.layer);
  const g = el('g', {
    transform:
      `translate(${e.x.toFixed(2)} ${e.y.toFixed(2)}) rotate(${e.rotation})` +
      (e.flip ? ' scale(-1 1)' : ''),
    stroke: color,
    color,
    fill: 'none',
    'stroke-width': 1.6,
    'stroke-linejoin': 'round',
    'stroke-linecap': 'round',
  });
  const def = SYMBOLS[e.item];
  if (def) {
    g.innerHTML = def.draw(e.w, e.h);
  } else if (e.item.startsWith('custom:')) {
    const cd = doc.customItems[e.item.slice(7)];
    if (cd) {
      const sx = e.w / (cd.w || 1);
      const sy = e.h / (cd.h || 1);
      for (const p of cd.paths) {
        const vts = p.vertices.map((v0) => ({
          x: v0.x * sx,
          y: v0.y * sy,
          r: v0.r ? (v0.r * (sx + sy)) / 2 : undefined,
        }));
        g.appendChild(el('path', { d: pathD(vts, p.closed) }));
      }
    } else {
      g.appendChild(el('rect', { x: -e.w / 2, y: -e.h / 2, width: e.w, height: e.h, 'stroke-dasharray': '5 4' }));
    }
  } else {
    g.appendChild(el('rect', { x: -e.w / 2, y: -e.h / 2, width: e.w, height: e.h, 'stroke-dasharray': '5 4' }));
  }
  if (o.interactive) {
    g.appendChild(
      el('rect', {
        x: -e.w / 2,
        y: -e.h / 2,
        width: e.w,
        height: e.h,
        fill: 'rgba(0,0,0,0)',
        stroke: 'none',
        class: 'hit',
        'pointer-events': 'fill',
      }),
    );
  }
  return g;
}

const DIM_TEXT = 15; // cm
const TICK = 10;

function buildDim(e: DimEnt, o: RenderOpts): SVGGElement {
  const color = layerColor(o.palette, e.layer);
  const g = el('g', { stroke: color, fill: 'none', 'stroke-width': 1.1 });
  const dir = norm(sub(e.b, e.a));
  const n = perp(dir);
  const A = add(e.a, mul(n, e.offset));
  const B = add(e.b, mul(n, e.offset));
  const os = Math.sign(e.offset || 1);
  // extension lines: small gap at the measured points, slight overshoot past the line
  for (const [p, q] of [
    [e.a, A],
    [e.b, B],
  ] as const) {
    const g1 = add(p, mul(n, os * 4));
    const q1 = add(q, mul(n, os * 6));
    g.appendChild(el('line', { x1: g1.x, y1: g1.y, x2: q1.x, y2: q1.y, 'stroke-width': 0.8 }));
  }
  g.appendChild(el('line', { x1: A.x, y1: A.y, x2: B.x, y2: B.y }));
  // 45° tick marks
  const tick = mul(norm(add(dir, n)), TICK / 2);
  for (const p of [A, B]) {
    g.appendChild(el('line', { x1: p.x - tick.x, y1: p.y - tick.y, x2: p.x + tick.x, y2: p.y + tick.y }));
  }
  // label, kept readable (never upside down)
  let deg = (Math.atan2(dir.y, dir.x) * 180) / Math.PI;
  let rdir = dir;
  if (deg > 90 + 1e-6 || deg <= -90) {
    deg -= 180;
    rdir = mul(dir, -1);
  }
  deg = ((deg % 360) + 360) % 360;
  const mid = lerp(A, B, 0.5);
  const tp = add(mid, mul(perp(rdir), -6));
  const label = formatLen(dist(e.a, e.b), o.unit, e.precision);
  g.appendChild(
    el(
      'text',
      {
        transform: `translate(${tp.x.toFixed(2)} ${tp.y.toFixed(2)}) rotate(${deg.toFixed(2)})`,
        'text-anchor': 'middle',
        'font-size': DIM_TEXT,
        fill: color,
        stroke: 'none',
      },
      label,
    ),
  );
  if (o.interactive) {
    g.appendChild(
      el('line', {
        x1: A.x,
        y1: A.y,
        x2: B.x,
        y2: B.y,
        stroke: 'rgba(0,0,0,0)',
        'stroke-width': 14,
        class: 'hit',
        'pointer-events': 'stroke',
      }),
    );
  }
  return g;
}

function buildAngle(e: AngleEnt, o: RenderOpts): SVGGElement {
  const color = layerColor(o.palette, e.layer);
  const g = el('g', { stroke: color, fill: 'none', 'stroke-width': 1.1 });
  const dirA = norm(sub(e.a, e.vertex));
  const dirB = norm(sub(e.b, e.vertex));
  // degenerate: a or b coincides with the vertex — nothing sensible to draw
  if (dist(e.vertex, e.a) < 1e-6 || dist(e.vertex, e.b) < 1e-6) return g;
  const legLen = Math.max(e.radius + 20, dist(e.vertex, e.a), dist(e.vertex, e.b));
  for (const dir of [dirA, dirB]) {
    const p = add(e.vertex, mul(dir, legLen));
    g.appendChild(
      el('line', { x1: e.vertex.x, y1: e.vertex.y, x2: p.x, y2: p.y, 'stroke-width': 0.8 }),
    );
  }
  const angA = Math.atan2(dirA.y, dirA.x);
  const angB = Math.atan2(dirB.y, dirB.x);
  let sweep = angB - angA;
  while (sweep > Math.PI) sweep -= 2 * Math.PI;
  while (sweep <= -Math.PI) sweep += 2 * Math.PI;
  const sweepFlag = sweep > 0 ? 1 : 0;
  const p1 = add(e.vertex, mul(dirA, e.radius));
  const p2 = add(e.vertex, mul(dirB, e.radius));
  g.appendChild(
    el('path', { d: `M ${p1.x} ${p1.y} A ${e.radius} ${e.radius} 0 0 ${sweepFlag} ${p2.x} ${p2.y}` }),
  );
  const deg = angleBetweenDeg(dirA, dirB);
  const midAng = angA + sweep / 2;
  const labelR = e.radius + 14;
  const lp = {
    x: e.vertex.x + Math.cos(midAng) * labelR,
    y: e.vertex.y + Math.sin(midAng) * labelR,
  };
  g.appendChild(
    el(
      'text',
      {
        x: lp.x,
        y: lp.y,
        'text-anchor': 'middle',
        'dominant-baseline': 'middle',
        'font-size': DIM_TEXT,
        fill: color,
        stroke: 'none',
      },
      `${deg.toFixed(e.precision ?? 1)}°`,
    ),
  );
  if (o.interactive) {
    for (const p of [e.a, e.b]) {
      g.appendChild(
        el('line', {
          x1: e.vertex.x,
          y1: e.vertex.y,
          x2: p.x,
          y2: p.y,
          stroke: 'rgba(0,0,0,0)',
          'stroke-width': 14,
          class: 'hit',
          'pointer-events': 'stroke',
        }),
      );
    }
  }
  return g;
}

function buildText(e: TextEnt, o: RenderOpts): SVGGElement {
  const color = layerColor(o.palette, e.layer);
  const g = el('g');
  const lines = e.text.split('\n');
  const t = el('text', { x: e.x, y: e.y, 'font-size': e.size, fill: color, stroke: 'none' });
  lines.forEach((line, i) => {
    t.appendChild(el('tspan', { x: e.x, dy: i === 0 ? 0 : e.size * 1.25 }, line || ' '));
  });
  g.appendChild(t);
  if (o.interactive) {
    const w = Math.max(30, Math.max(...lines.map((l) => l.length)) * e.size * 0.6);
    const h = lines.length * e.size * 1.25;
    g.appendChild(
      el('rect', {
        x: e.x - 4,
        y: e.y - e.size,
        width: w + 8,
        height: h + 8,
        fill: 'rgba(0,0,0,0)',
        stroke: 'none',
        class: 'hit',
        'pointer-events': 'fill',
      }),
    );
  }
  return g;
}

/** Area of the room a closed path encloses; walls measure the inner face. */
export function pathAreaCm2(p: PathEnt): number | null {
  if (!p.closed || p.vertices.length < 3) return null;
  const poly = p.wall ? wallInnerFace(p) : p.vertices;
  return polygonArea(flattenPath(poly, true));
}

function buildAreaLabel(doc: Doc, e: AreaLabelEnt, o: RenderOpts): SVGGElement | null {
  const path = doc.entities.find((x) => x.id === e.pathId);
  if (!path || path.kind !== 'path') return null;
  const area = pathAreaCm2(path);
  const color = layerColor(o.palette, e.layer);
  const g = el('g');
  g.appendChild(
    el(
      'text',
      {
        x: e.x,
        y: e.y,
        'text-anchor': 'middle',
        'font-size': 18,
        'letter-spacing': 2,
        fill: color,
        stroke: 'none',
      },
      e.name.toUpperCase(),
    ),
  );
  g.appendChild(
    el(
      'text',
      { x: e.x, y: e.y + 22, 'text-anchor': 'middle', 'font-size': 14, fill: o.palette.muted, stroke: 'none' },
      area == null ? '—' : formatArea(area),
    ),
  );
  if (o.interactive) {
    g.appendChild(
      el('rect', {
        x: e.x - 60,
        y: e.y - 20,
        width: 120,
        height: 50,
        fill: 'rgba(0,0,0,0)',
        stroke: 'none',
        class: 'hit',
        'pointer-events': 'fill',
      }),
    );
  }
  return g;
}

/** Draw the background grid for the visible area (world coords). */
export function renderGrid(
  g: SVGGElement,
  view: ViewState,
  rect: BBox,
  gridSize: number,
  show: boolean,
  palette: Palette,
): void {
  g.innerHTML = '';
  if (!show || gridSize <= 0) return;
  let step = gridSize;
  while (step * view.scale < 9) step *= 2;
  const major = 100;
  const minorD: string[] = [];
  const majorD: string[] = [];
  const x0 = Math.floor(rect.minX / step) * step;
  const y0 = Math.floor(rect.minY / step) * step;
  for (let x = x0; x <= rect.maxX; x += step) {
    (Math.abs(x % major) < 1e-6 ? majorD : minorD).push(
      `M ${x} ${rect.minY} L ${x} ${rect.maxY}`,
    );
  }
  for (let y = y0; y <= rect.maxY; y += step) {
    (Math.abs(y % major) < 1e-6 ? majorD : minorD).push(
      `M ${rect.minX} ${y} L ${rect.maxX} ${y}`,
    );
  }
  if (step < major) {
    // ensure major lines exist even when step doesn't land on them
    for (let x = Math.floor(rect.minX / major) * major; x <= rect.maxX; x += major)
      majorD.push(`M ${x} ${rect.minY} L ${x} ${rect.maxY}`);
    for (let y = Math.floor(rect.minY / major) * major; y <= rect.maxY; y += major)
      majorD.push(`M ${rect.minX} ${y} L ${rect.maxX} ${y}`);
  }
  const sw = 1 / view.scale;
  g.appendChild(el('path', { d: minorD.join(' '), stroke: palette.gridMinor, 'stroke-width': sw, fill: 'none' }));
  g.appendChild(el('path', { d: majorD.join(' '), stroke: palette.gridMajor, 'stroke-width': sw, fill: 'none' }));
}
