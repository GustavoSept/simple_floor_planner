// Parametric, architect-style plan symbols. Each draw() returns SVG markup
// centered on the origin, sized w×h (cm), stroked with currentColor.

export interface SymbolDef {
  name: string;
  cat: 'furniture' | 'electrical' | 'plumbing';
  w: number;
  h: number;
  draw: (w: number, h: number) => string;
}

const R = (x: number, y: number, w: number, h: number, rx = 0, extra = '') =>
  `<rect x="${f(x)}" y="${f(y)}" width="${f(w)}" height="${f(h)}" rx="${f(rx)}" ${extra}/>`;
const C = (cx: number, cy: number, r: number, extra = '') =>
  `<circle cx="${f(cx)}" cy="${f(cy)}" r="${f(r)}" ${extra}/>`;
const E = (cx: number, cy: number, rx: number, ry: number) =>
  `<ellipse cx="${f(cx)}" cy="${f(cy)}" rx="${f(rx)}" ry="${f(ry)}"/>`;
const L = (x1: number, y1: number, x2: number, y2: number) =>
  `<line x1="${f(x1)}" y1="${f(y1)}" x2="${f(x2)}" y2="${f(y2)}"/>`;
const P = (d: string, extra = '') => `<path d="${d}" ${extra}/>`;
const T = (x: number, y: number, size: number, text: string) =>
  `<text x="${f(x)}" y="${f(y)}" font-size="${f(size)}" text-anchor="middle" ` +
  `fill="currentColor" stroke="none" font-family="inherit">${text}</text>`;
const f = (n: number) => (Math.round(n * 100) / 100).toString();

export const SYMBOLS: Record<string, SymbolDef> = {
  // ---- furniture --------------------------------------------------------
  sofa: {
    name: 'Sofa',
    cat: 'furniture',
    w: 200,
    h: 90,
    draw: (w, h) => {
      const arm = Math.min(18, w * 0.12);
      const back = Math.min(16, h * 0.22);
      const seatW = w - arm * 2;
      return (
        R(-w / 2, -h / 2, w, h, 8) +
        R(-w / 2 + arm, -h / 2 + back, seatW, h - back, 4) +
        L(0, -h / 2 + back, 0, h / 2)
      );
    },
  },
  armchair: {
    name: 'Armchair',
    cat: 'furniture',
    w: 85,
    h: 80,
    draw: (w, h) => {
      const arm = Math.min(14, w * 0.18);
      const back = Math.min(14, h * 0.2);
      return R(-w / 2, -h / 2, w, h, 8) + R(-w / 2 + arm, -h / 2 + back, w - arm * 2, h - back, 4);
    },
  },
  bed_double: {
    name: 'Double bed',
    cat: 'furniture',
    w: 160,
    h: 200,
    draw: (w, h) => {
      const pw = w / 2 - 12;
      const ph = Math.min(35, h * 0.18);
      return (
        R(-w / 2, -h / 2, w, h) +
        R(-w / 2 + 8, -h / 2 + 6, pw, ph, 6) +
        R(4, -h / 2 + 6, pw, ph, 6) +
        L(-w / 2, -h / 2 + ph + 18, w / 2, -h / 2 + ph + 18)
      );
    },
  },
  bed_single: {
    name: 'Single bed',
    cat: 'furniture',
    w: 90,
    h: 200,
    draw: (w, h) => {
      const ph = Math.min(35, h * 0.18);
      return (
        R(-w / 2, -h / 2, w, h) +
        R(-w / 2 + 8, -h / 2 + 6, w - 16, ph, 6) +
        L(-w / 2, -h / 2 + ph + 18, w / 2, -h / 2 + ph + 18)
      );
    },
  },
  table: {
    name: 'Table',
    cat: 'furniture',
    w: 140,
    h: 80,
    draw: (w, h) => R(-w / 2, -h / 2, w, h),
  },
  table_round: {
    name: 'Round table',
    cat: 'furniture',
    w: 110,
    h: 110,
    draw: (w, h) => E(0, 0, w / 2, h / 2),
  },
  chair: {
    name: 'Chair',
    cat: 'furniture',
    w: 45,
    h: 45,
    draw: (w, h) =>
      R(-w / 2, -h / 2 + h * 0.12, w, h * 0.88, 4) + L(-w / 2, -h / 2, w / 2, -h / 2),
  },
  office_chair: {
    name: 'Office chair',
    cat: 'furniture',
    w: 60,
    h: 60,
    draw: (w, h) => {
      const baseR = Math.min(w, h) / 2; // reach of the 5-star base to its casters
      const hubR = baseR * 0.13;
      const casterR = baseR * 0.1;
      const seatR = baseR * 0.6;
      const backW = seatR * 1.5;
      const backY = -seatR - Math.min(9, h * 0.14);
      let s = '';
      for (let i = 0; i < 5; i++) {
        const a = -Math.PI / 2 + (i * 2 * Math.PI) / 5;
        const ex = Math.cos(a) * baseR;
        const ey = Math.sin(a) * baseR;
        s += L(0, 0, ex * 0.82, ey * 0.82) + C(ex, ey, casterR);
      }
      s += C(0, 0, hubR) + C(0, 0, seatR);
      s += P(`M ${f(-backW / 2)} ${f(backY)} A ${f(backW / 2)} ${f(backW / 2)} 0 0 0 ${f(backW / 2)} ${f(backY)}`);
      return s;
    },
  },
  computer: {
    name: 'Computer',
    cat: 'furniture',
    w: 110,
    h: 50,
    draw: (w, h) => {
      const mw = w * 0.46; // each monitor
      const md = Math.max(4, Math.min(6, h * 0.14));
      const my = -h / 2 + md;
      const tilt = 7; // monitors angled toward the user
      const kw = w * 0.36;
      const kh = Math.max(8, Math.min(14, h * 0.28));
      const ky = h / 2 - kh - 2;
      return (
        R(-mw / 2, -md / 2, mw, md, 1, `transform="translate(${f(-w / 4)} ${f(my)}) rotate(${tilt})"`) +
        R(-mw / 2, -md / 2, mw, md, 1, `transform="translate(${f(w / 4)} ${f(my)}) rotate(${-tilt})"`) +
        L(-w / 4, my + md, -w / 4, my + md + 3) +
        L(w / 4, my + md, w / 4, my + md + 3) +
        R(-kw / 2, ky, kw, kh, 2) +
        R(kw / 2 + Math.min(8, w * 0.07), ky + kh * 0.25, Math.min(8, w * 0.07), Math.min(11, kh * 0.8), 3)
      );
    },
  },
  wardrobe: {
    name: 'Wardrobe',
    cat: 'furniture',
    w: 150,
    h: 60,
    draw: (w, h) => R(-w / 2, -h / 2, w, h) + L(-w / 2, 0, w / 2, 0) + L(0, -h / 2, 0, h / 2),
  },
  corner_wardrobe: {
    name: 'Corner wardrobe',
    cat: 'furniture',
    w: 105,
    h: 105,
    draw: (w, h) => {
      // square footprint flush against two walls (top, left); the outer corner is
      // chamfered so the two remaining free edges are ~56cm — the accessible front.
      const straight = 56;
      const legW = Math.max(0, w - straight);
      const legH = Math.max(0, h - straight);
      const p1 = { x: -w / 2, y: -h / 2 };
      const p2 = { x: w / 2, y: -h / 2 };
      const p3 = { x: w / 2, y: h / 2 - legH };
      const p4 = { x: w / 2 - legW, y: h / 2 };
      const p5 = { x: -w / 2, y: h / 2 };
      const outline =
        `M ${f(p1.x)} ${f(p1.y)} L ${f(p2.x)} ${f(p2.y)} L ${f(p3.x)} ${f(p3.y)} ` +
        `L ${f(p4.x)} ${f(p4.y)} L ${f(p5.x)} ${f(p5.y)} Z`;
      return P(outline) + L(p1.x, p1.y, (p3.x + p4.x) / 2, (p3.y + p4.y) / 2);
    },
  },
  stairs: {
    name: 'Stairs',
    cat: 'furniture',
    w: 100,
    h: 280,
    draw: (w, h) => {
      const treads = Math.max(3, Math.round(h / 27));
      let s = R(-w / 2, -h / 2, w, h);
      for (let i = 1; i < treads; i++) {
        const y = -h / 2 + (h * i) / treads;
        s += L(-w / 2, y, w / 2, y);
      }
      // direction arrow (up = toward -y)
      s += P(
        `M 0 ${f(h / 2 - 10)} L 0 ${f(-h / 2 + 18)} M -8 ${f(-h / 2 + 28)} L 0 ${f(-h / 2 + 18)} L 8 ${f(-h / 2 + 28)}`,
      );
      return s;
    },
  },
  sink_kitchen: {
    name: 'Kitchen sink',
    cat: 'furniture',
    w: 90,
    h: 55,
    draw: (w, h) =>
      R(-w / 2, -h / 2, w, h) +
      R(-w / 2 + 8, -h / 2 + 10, w - 16, h - 18, 6) +
      C(0, -h / 2 + 5, 3),
  },
  washbasin: {
    name: 'Washbasin',
    cat: 'furniture',
    w: 55,
    h: 45,
    draw: (w, h) => E(0, h * 0.06, w / 2 - 4, h / 2 - 6) + R(-w / 2, -h / 2, w, h) + C(0, -h / 2 + 7, 3),
  },
  toilet: {
    name: 'Toilet',
    cat: 'furniture',
    w: 40,
    h: 68,
    draw: (w, h) => {
      const tank = Math.min(16, h * 0.24);
      return (
        R(-w / 2, -h / 2, w, tank) +
        E(0, tank / 2 + (h / 2 - tank / 2) * 0.35, w / 2 - 3, (h - tank) / 2 - 4)
      );
    },
  },
  bathtub: {
    name: 'Bathtub',
    cat: 'furniture',
    w: 170,
    h: 75,
    draw: (w, h) =>
      R(-w / 2, -h / 2, w, h, 6) + R(-w / 2 + 9, -h / 2 + 9, w - 18, h - 18, Math.min(24, h / 2 - 9)) + C(-w / 2 + 24, 0, 3),
  },
  shower: {
    name: 'Shower',
    cat: 'furniture',
    w: 90,
    h: 90,
    draw: (w, h) =>
      R(-w / 2, -h / 2, w, h) +
      L(-w / 2, -h / 2, w / 2, h / 2) +
      L(w / 2, -h / 2, -w / 2, h / 2) +
      C(0, 0, 4),
  },
  stove: {
    name: 'Stove',
    cat: 'furniture',
    w: 60,
    h: 60,
    draw: (w, h) => {
      const dx = w / 4.4;
      const dy = h / 4.4;
      const r = Math.min(w, h) / 6.5;
      return (
        R(-w / 2, -h / 2, w, h) +
        C(-dx, -dy, r) +
        C(dx, -dy, r * 0.8) +
        C(-dx, dy, r * 0.8) +
        C(dx, dy, r)
      );
    },
  },
  fridge: {
    name: 'Fridge',
    cat: 'furniture',
    w: 70,
    h: 70,
    draw: (w, h) => R(-w / 2, -h / 2, w, h) + L(-w / 2, -h / 2, w / 2, h / 2),
  },
  washer: {
    name: 'Washer',
    cat: 'furniture',
    w: 60,
    h: 60,
    draw: (w, h) => {
      const r = Math.min(w, h) / 2 - 10;
      return R(-w / 2, -h / 2, w, h) + C(0, 2, r) + C(0, 2, r * 0.45);
    },
  },
  plant: {
    name: 'Plant',
    cat: 'furniture',
    w: 50,
    h: 50,
    draw: (w, h) => {
      const r = Math.min(w, h) / 2;
      let s = C(0, 0, r);
      for (let i = 0; i < 6; i++) {
        const a = (i * Math.PI) / 3;
        s += L(0, 0, Math.cos(a) * r * 0.85, Math.sin(a) * r * 0.85);
      }
      return s;
    },
  },

  // ---- electrical -------------------------------------------------------
  outlet: {
    name: 'Outlet',
    cat: 'electrical',
    w: 30,
    h: 30,
    draw: (w, h) => {
      const r = Math.min(w, h) / 2 - 4;
      return (
        C(0, 0, r) +
        L(-r * 0.55, -r * 0.35, r * 0.55, -r * 0.35) +
        L(-r * 0.55, r * 0.35, r * 0.55, r * 0.35)
      );
    },
  },
  switch: {
    name: 'Switch',
    cat: 'electrical',
    w: 26,
    h: 26,
    draw: (w, h) => {
      const r = Math.min(w, h) / 2 - 6;
      return C(0, 3, r) + L(r * 0.5, 3 - r * 0.85, r * 1.6, 3 - r * 2.2) + L(r * 1.6, 3 - r * 2.2, r * 2.3, 3 - r * 1.8);
    },
  },
  light: {
    name: 'Ceiling light',
    cat: 'electrical',
    w: 32,
    h: 32,
    draw: (w, h) => {
      const r = Math.min(w, h) / 2 - 4;
      const k = r * 0.707;
      return C(0, 0, r) + L(-k, -k, k, k) + L(k, -k, -k, k);
    },
  },
  wall_light: {
    name: 'Wall light',
    cat: 'electrical',
    w: 28,
    h: 28,
    draw: (w, h) => {
      const r = Math.min(w, h) / 2 - 4;
      return P(`M ${f(-r)} 0 A ${f(r)} ${f(r)} 0 0 1 ${f(r)} 0 Z`) + L(0, 0, 0, -r * 0.9);
    },
  },
  panel: {
    name: 'Elec. panel',
    cat: 'electrical',
    w: 40,
    h: 20,
    draw: (w, h) => R(-w / 2, -h / 2, w, h) + L(-w / 2, h / 2, w / 2, -h / 2),
  },

  // ---- plumbing ---------------------------------------------------------
  water_point: {
    name: 'Water point',
    cat: 'plumbing',
    w: 26,
    h: 26,
    draw: (w, h) =>
      P(`M ${f(-w / 2)} ${f(-h / 2)} L ${f(w / 2)} ${f(-h / 2)} L 0 ${f(h / 2)} Z`),
  },
  drain: {
    name: 'Drain',
    cat: 'plumbing',
    w: 28,
    h: 28,
    draw: (w, h) => {
      const r = Math.min(w, h) / 2 - 3;
      return C(0, 0, r) + L(-r, 0, r, 0) + L(0, -r, 0, r);
    },
  },
  floor_drain: {
    name: 'Floor drain',
    cat: 'plumbing',
    w: 30,
    h: 30,
    draw: (w, h) => {
      const r = Math.min(w, h) / 2 - 6;
      return R(-w / 2 + 2, -h / 2 + 2, w - 4, h - 4) + C(0, 0, r) + L(-r * 0.7, -r * 0.7, r * 0.7, r * 0.7);
    },
  },
  water_heater: {
    name: 'Water heater',
    cat: 'plumbing',
    w: 45,
    h: 45,
    draw: (w, h) => C(0, 0, Math.min(w, h) / 2 - 2) + T(0, Math.min(w, h) * 0.12, Math.min(w, h) * 0.36, 'WH'),
  },
};

export const SYMBOL_CATS: { cat: SymbolDef['cat']; label: string }[] = [
  { cat: 'furniture', label: 'Furniture' },
  { cat: 'electrical', label: 'Electrical' },
  { cat: 'plumbing', label: 'Plumbing' },
];
