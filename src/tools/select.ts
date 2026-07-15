import type { DimEnt, Doc, Entity, ItemEnt, OpeningEnt, PathEnt, Vec } from '../types';
import {
  add,
  bboxIntersects,
  bboxOf,
  bboxUnion,
  cornerArc,
  dist,
  dot,
  formatLen,
  mul,
  norm,
  pathD,
  perp,
  pointSeg,
  sub,
  type BBox,
} from '../geom';
import { entityBBox, moveEntity, nearestWallPlacement, rotateEntity } from '../entity';
import { el } from '../render';
import {
  chip,
  clearHud,
  editable,
  ovSnap,
  snapMoveFree,
  tol,
  type Tool,
  type ToolCtx,
  type ToolEvent,
} from './base';

type Drag =
  | { t: 'idle' }
  | { t: 'marquee'; start: Vec; cur: Vec; additive: boolean }
  | { t: 'move'; start: Vec; anchor0: Vec; clicked: string | null; shift: boolean; moved: boolean }
  | { t: 'vertex'; entId: string; idx: number; moved: boolean }
  | { t: 'radius'; entId: string; idx: number; moved: boolean }
  | { t: 'rotate'; center: Vec; startAng: number; moved: boolean }
  | { t: 'opening'; entId: string; moved: boolean }
  | { t: 'dimoff'; entId: string; moved: boolean }
  | { t: 'dimend'; entId: string; which: 'a' | 'b'; moved: boolean };

export class SelectTool implements Tool {
  readonly id = 'select' as const;
  readonly hint =
    'Click to select · drag to move · drag a ○ edge midpoint (or double-click an edge) to add a vertex · Del deletes · Q/E rotates 90°';
  private drag: Drag = { t: 'idle' };
  private base: Doc | null = null; // doc at drag start
  /** Active vertex of the single selected path (drives properties panel). */
  vertexSel: { entId: string; idx: number } | null = null;

  constructor(private ctx: ToolCtx) {}

  deactivate(): void {
    this.drag = { t: 'idle' };
    this.vertexSel = null;
    clearHud(this.ctx);
  }

  private ent<T extends Entity>(doc: Doc, id: string): T | undefined {
    return doc.entities.find((e) => e.id === id) as T | undefined;
  }

  down(ev: ToolEvent): void {
    if (ev.e.button !== 0) return;
    const ctx = this.ctx;
    const doc = ctx.store.doc;
    this.base = doc;
    const target = ev.e.target as Element;
    const handleEl = target.closest('[data-handle]');
    const single = ctx.sel.single;

    if (handleEl && single) {
      const h = handleEl.getAttribute('data-handle')!;
      if (h.startsWith('v:')) {
        const idx = parseInt(h.slice(2), 10);
        this.vertexSel = { entId: single, idx };
        this.drag = { t: 'vertex', entId: single, idx, moved: false };
        ctx.uiRefresh();
        return;
      }
      if (h.startsWith('m:')) {
        // midpoint handle: insert a vertex there and start dragging it
        const seg = parseInt(h.slice(2), 10);
        const ent = this.ent<PathEnt>(doc, single);
        if (ent?.kind === 'path') {
          const n = ent.vertices.length;
          const a = ent.vertices[seg];
          const b = ent.vertices[(seg + 1) % n];
          const vertices = [...ent.vertices];
          vertices.splice(seg + 1, 0, {
            x: Math.round((a.x + b.x) / 2),
            y: Math.round((a.y + b.y) / 2),
          });
          ctx.store.updatePathVertices(single, vertices);
          this.base = ctx.store.doc;
          this.vertexSel = { entId: single, idx: seg + 1 };
          this.drag = { t: 'vertex', entId: single, idx: seg + 1, moved: false };
          ctx.uiRefresh();
        }
        return;
      }
      if (h.startsWith('r:')) {
        const idx = parseInt(h.slice(2), 10);
        this.vertexSel = { entId: single, idx };
        this.drag = { t: 'radius', entId: single, idx, moved: false };
        return;
      }
      if (h === 'dima' || h === 'dimb') {
        this.drag = { t: 'dimend', entId: single, which: h === 'dima' ? 'a' : 'b', moved: false };
        return;
      }
    }
    if (handleEl?.getAttribute('data-handle') === 'rot' && ctx.sel.ids.size) {
      const b = this.selectionBBox(doc);
      if (b) {
        const center = { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 };
        this.drag = {
          t: 'rotate',
          center,
          startAng: Math.atan2(ev.raw.y - center.y, ev.raw.x - center.x),
          moved: false,
        };
        return;
      }
    }

    const entEl = target.closest('.ent[data-id]');
    const entId = entEl?.getAttribute('data-id') ?? null;
    if (entId && editable(doc, entId)) {
      const ent = this.ent(doc, entId)!;
      if (ev.e.shiftKey) {
        ctx.sel.toggle(entId);
        this.vertexSel = null;
        ctx.uiRefresh();
        return;
      }
      if (!ctx.sel.has(entId)) {
        ctx.sel.set([entId]);
        this.vertexSel = null;
        ctx.uiRefresh();
      }
      if (ent.kind === 'opening') {
        this.drag = { t: 'opening', entId, moved: false };
      } else if (ent.kind === 'dim' && ctx.sel.single === entId) {
        this.drag = { t: 'dimoff', entId, moved: false };
      } else {
        this.drag = {
          t: 'move',
          start: ev.raw,
          anchor0: this.moveAnchor(doc, ev.raw),
          clicked: entId,
          shift: false,
          moved: false,
        };
      }
      return;
    }

    // empty space: marquee
    if (!ev.e.shiftKey) {
      ctx.sel.clear();
      this.vertexSel = null;
      ctx.uiRefresh();
    }
    this.drag = { t: 'marquee', start: ev.raw, cur: ev.raw, additive: ev.e.shiftKey };
  }

  private moveAnchor(doc: Doc, grab: Vec): Vec {
    let best = grab;
    let bestD = Infinity;
    for (const id of this.ctx.sel.ids) {
      const e = this.ent(doc, id);
      if (!e) continue;
      const pts: Vec[] =
        e.kind === 'path'
          ? e.vertices
          : e.kind === 'item' || e.kind === 'text' || e.kind === 'arealabel'
            ? [{ x: e.x, y: e.y }]
            : e.kind === 'dim'
              ? [e.a, e.b]
              : [];
      for (const p of pts) {
        const d = dist(grab, p);
        if (d < bestD) {
          bestD = d;
          best = { x: p.x, y: p.y };
        }
      }
    }
    return best;
  }

  move(ev: ToolEvent): void {
    const ctx = this.ctx;
    const d = this.drag;
    if (d.t === 'idle' || !this.base) return;
    const base = this.base;
    clearHud(ctx);
    const unit = ctx.settings.value.unit;

    switch (d.t) {
      case 'marquee': {
        d.cur = ev.raw;
        ctx.requestRender();
        return;
      }
      case 'move': {
        const raw = add(d.anchor0, sub(ev.raw, d.start));
        const hit = snapMoveFree(ctx, d.anchor0, raw, ev.e, ctx.sel.ids);
        const delta = sub(hit.p, d.anchor0);
        if (!d.moved && dist(ev.raw, d.start) < tol(ctx) / 2) return;
        d.moved = true;
        const ids = ctx.sel.ids;
        const entities = base.entities.map((e) =>
          ids.has(e.id) && editable(base, e.id) ? moveEntity(e, delta) : e,
        );
        ctx.store.preview({ ...base, entities });
        return;
      }
      case 'vertex': {
        const ent = this.ent<PathEnt>(base, d.entId);
        if (!ent) return;
        const anchor = ent.vertices[d.idx];
        const hit = snapMoveFree(ctx, anchor, ev.raw, ev.e, new Set([d.entId]));
        d.moved = true;
        const vertices = ent.vertices.map((v0, i) =>
          i === d.idx ? { ...v0, x: hit.p.x, y: hit.p.y } : v0,
        );
        this.previewPatch(base, d.entId, { vertices });
        // show the lengths of the two adjacent segments
        const n = vertices.length;
        const parts: string[] = [];
        if (ent.closed || d.idx > 0)
          parts.push(formatLen(dist(vertices[(d.idx - 1 + n) % n], vertices[d.idx]), unit));
        if (ent.closed || d.idx < n - 1)
          parts.push(formatLen(dist(vertices[d.idx], vertices[(d.idx + 1) % n]), unit));
        chip(ctx, hit.p, parts.join(' · '));
        return;
      }
      case 'radius': {
        const ent = this.ent<PathEnt>(base, d.entId);
        if (!ent) return;
        const n = ent.vertices.length;
        const cur = ent.vertices[d.idx];
        const prev = ent.vertices[(d.idx - 1 + n) % n];
        const next = ent.vertices[(d.idx + 1) % n];
        const dIn = norm(sub(cur, prev));
        const dOut = norm(sub(next, cur));
        const cosA = -dot(dIn, dOut);
        const ang = Math.acos(Math.max(-1, Math.min(1, cosA)));
        const half = ang / 2;
        const sinH = Math.sin(half);
        const tanH = Math.tan(half);
        if (sinH < 1e-3 || tanH < 1e-3) return;
        // choose r so the arc midpoint lands at the cursor distance from the corner
        const dCur = dist(ev.raw, cur);
        let r = (dCur * sinH) / Math.max(1e-3, 1 - sinH);
        const maxTrim = 0.48 * Math.min(dist(prev, cur), dist(cur, next));
        r = Math.max(0, Math.min(r, maxTrim * tanH));
        r = Math.round(r * 10) / 10;
        d.moved = true;
        const vertices = ent.vertices.map((v0, i) =>
          i === d.idx ? { ...v0, r: r < 1 ? undefined : r } : v0,
        );
        this.previewPatch(base, d.entId, { vertices });
        chip(ctx, ev.raw, `r ${formatLen(r, unit)}`);
        return;
      }
      case 'rotate': {
        const ang = Math.atan2(ev.raw.y - d.center.y, ev.raw.x - d.center.x);
        let deg = ((ang - d.startAng) * 180) / Math.PI;
        if (!ev.e.altKey) deg = Math.round(deg / 15) * 15;
        d.moved = true;
        const ids = this.ctx.sel.ids;
        const entities = base.entities.map((e) =>
          ids.has(e.id) && editable(base, e.id) ? rotateEntity(e, d.center, deg) : e,
        );
        ctx.store.preview({ ...base, entities });
        chip(ctx, ev.raw, `${Math.round(deg)}°`);
        return;
      }
      case 'opening': {
        const ent = this.ent<OpeningEnt>(base, d.entId);
        if (!ent) return;
        const pl = nearestWallPlacement(base, ev.raw, tol(ctx) * 3);
        if (!pl) return;
        d.moved = true;
        this.previewPatch(base, d.entId, {
          wallId: pl.wall.id,
          seg: pl.seg,
          t: Math.round(pl.t),
        });
        return;
      }
      case 'dimoff': {
        const ent = this.ent<DimEnt>(base, d.entId);
        if (!ent) return;
        const dir = norm(sub(ent.b, ent.a));
        const off = dot(sub(ev.raw, ent.a), perp(dir));
        d.moved = true;
        this.previewPatch(base, d.entId, { offset: Math.round(off) });
        return;
      }
      case 'dimend': {
        const ent = this.ent<DimEnt>(base, d.entId);
        if (!ent) return;
        const hit = snapMoveFree(ctx, ent[d.which], ev.raw, ev.e);
        d.moved = true;
        this.previewPatch(base, d.entId, { [d.which]: hit.p } as Partial<DimEnt>);
        this.ctx.overlay.querySelectorAll('.ov-snap').forEach((n) => n.remove());
        ovSnap(this.ctx.overlay, hit, this.ctx.view.view.scale);
        return;
      }
    }
  }

  private previewPatch(base: Doc, id: string, patch: Partial<Entity>): void {
    const entities = base.entities.map((e) => (e.id === id ? ({ ...e, ...patch } as Entity) : e));
    this.ctx.store.preview({ ...base, entities });
  }

  up(ev: ToolEvent): void {
    const ctx = this.ctx;
    const d = this.drag;
    if (d.t === 'marquee') {
      const doc = ctx.store.doc;
      const box = bboxOf([d.start, d.cur]);
      const picked: string[] = [];
      if (dist(d.start, d.cur) > tol(ctx) / 2) {
        for (const e of doc.entities) {
          if (!editable(doc, e.id)) continue;
          const b = entityBBox(doc, e);
          if (b && bboxIntersects(box, b)) picked.push(e.id);
        }
      }
      if (d.additive) ctx.sel.set([...ctx.sel.ids, ...picked]);
      else if (picked.length) ctx.sel.set(picked);
      ctx.uiRefresh();
    } else if (d.t !== 'idle') {
      const moved = 'moved' in d && d.moved;
      if (moved) {
        ctx.store.commit(ctx.store.doc);
      } else if (d.t === 'move' && d.clicked && ctx.sel.ids.size > 1 && !ev.e.shiftKey) {
        // plain click on one entity of a multi-selection: select just it
        ctx.sel.set([d.clicked]);
      }
      ctx.uiRefresh();
    }
    this.drag = { t: 'idle' };
    this.base = null;
    clearHud(ctx);
    ctx.requestRender();
  }

  dbl(ev: ToolEvent): void {
    const ctx = this.ctx;
    const doc = ctx.store.doc;
    // pointer capture retargets dblclick to the svg root, so hit-test by point
    const target = (document.elementFromPoint(ev.e.clientX, ev.e.clientY) ??
      ev.e.target) as Element;
    const entId = target.closest('.ent[data-id]')?.getAttribute('data-id');
    if (!entId || !editable(doc, entId)) return;
    const ent = this.ent(doc, entId);
    if (!ent) return;
    if (ent.kind === 'text') {
      ctx.editText(ent, { x: ent.x, y: ent.y });
      return;
    }
    if (ent.kind === 'path') {
      // insert a vertex at the nearest point on the nearest segment
      const vts = ent.vertices;
      const n = vts.length;
      const last = ent.closed ? n : n - 1;
      let bestI = -1;
      let bestD = Infinity;
      let bestP: Vec = ev.raw;
      for (let i = 0; i < last; i++) {
        const r = pointSeg(ev.raw, vts[i], vts[(i + 1) % n]);
        if (r.d < bestD) {
          bestD = r.d;
          bestI = i;
          bestP = r.q;
        }
      }
      if (bestI < 0) return;
      const vertices = [...vts];
      vertices.splice(bestI + 1, 0, { x: Math.round(bestP.x), y: Math.round(bestP.y) });
      ctx.store.updatePathVertices(entId, vertices);
      ctx.sel.set([entId]);
      this.vertexSel = { entId, idx: bestI + 1 };
      ctx.uiRefresh();
    }
  }

  key(e: KeyboardEvent): boolean {
    const ctx = this.ctx;
    if (e.key === 'Delete' || e.key === 'Backspace') {
      if (this.vertexSel) {
        this.deleteVertex(this.vertexSel.entId, this.vertexSel.idx);
        return true;
      }
      if (ctx.sel.ids.size) {
        ctx.store.deleteEntities(new Set(ctx.sel.ids));
        ctx.sel.clear();
        ctx.uiRefresh();
        return true;
      }
      return false;
    }
    if (e.key === 'Escape') {
      if (this.vertexSel) {
        this.vertexSel = null;
        ctx.uiRefresh();
        ctx.requestRender();
        return true;
      }
      if (ctx.sel.ids.size) {
        ctx.sel.clear();
        ctx.uiRefresh();
        return true;
      }
      return false;
    }
    if ((e.key === 'q' || e.key === 'Q' || e.key === 'e' || e.key === 'E') && ctx.sel.ids.size) {
      const deg = e.key.toLowerCase() === 'q' ? -90 : 90;
      const b = this.selectionBBox(ctx.store.doc);
      if (!b) return false;
      const center = { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 };
      const ids = ctx.sel.ids;
      const entities = ctx.store.doc.entities.map((en) =>
        ids.has(en.id) && editable(ctx.store.doc, en.id) ? rotateEntity(en, center, deg) : en,
      );
      ctx.store.commit({ ...ctx.store.doc, entities });
      return true;
    }
    if ((e.key === 'f' || e.key === 'F') && ctx.sel.single) {
      const ent = this.ent(ctx.store.doc, ctx.sel.single);
      if (ent?.kind === 'item') {
        ctx.store.updateEntity<ItemEnt>(ent.id, { flip: !ent.flip });
        return true;
      }
      if (ent?.kind === 'opening' && ent.opening === 'door') {
        ctx.store.updateEntity<OpeningEnt>(ent.id, { swing: ent.swing === 1 ? -1 : 1 });
        return true;
      }
    }
    if ((e.key === 'h' || e.key === 'H') && ctx.sel.single) {
      const ent = this.ent(ctx.store.doc, ctx.sel.single);
      if (ent?.kind === 'opening' && ent.opening === 'door') {
        ctx.store.updateEntity<OpeningEnt>(ent.id, { hinge: ent.hinge === 1 ? -1 : 1 });
        return true;
      }
    }
    if (e.key.startsWith('Arrow') && ctx.sel.ids.size) {
      const step = e.shiftKey ? 1 : Math.max(1, ctx.settings.value.gridSize);
      const delta: Vec = {
        x: e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0,
        y: e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0,
      };
      const ids = ctx.sel.ids;
      const entities = ctx.store.doc.entities.map((en) =>
        ids.has(en.id) && editable(ctx.store.doc, en.id) ? moveEntity(en, delta) : en,
      );
      ctx.store.commit({ ...ctx.store.doc, entities });
      return true;
    }
    return false;
  }

  deleteVertex(entId: string, idx: number): void {
    const ctx = this.ctx;
    const ent = this.ent<PathEnt>(ctx.store.doc, entId);
    if (!ent || ent.kind !== 'path') return;
    const min = ent.closed ? 3 : 2;
    if (ent.vertices.length <= min) {
      ctx.store.deleteEntities(new Set([entId]));
      ctx.sel.clear();
    } else {
      const vertices = ent.vertices.filter((_, i) => i !== idx);
      ctx.store.updatePathVertices(entId, vertices);
    }
    this.vertexSel = null;
    ctx.uiRefresh();
  }

  private selectionBBox(doc: Doc): BBox | null {
    let b: BBox | null = null;
    for (const id of this.ctx.sel.ids) {
      const e = this.ent(doc, id);
      if (!e) continue;
      const eb = entityBBox(doc, e);
      if (eb) b = b ? bboxUnion(b, eb) : eb;
    }
    return b;
  }

  renderOverlay(): void {
    const ctx = this.ctx;
    const g = ctx.overlay;
    g.innerHTML = '';
    const doc = ctx.store.doc;
    const scale = ctx.view.view.scale;
    const px = (n: number) => n / scale;

    if (this.drag.t === 'marquee') {
      const d = this.drag;
      const b = bboxOf([d.start, d.cur]);
      g.appendChild(
        el('rect', {
          x: b.minX,
          y: b.minY,
          width: b.maxX - b.minX,
          height: b.maxY - b.minY,
          class: 'ov-marquee',
          'vector-effect': 'non-scaling-stroke',
        }),
      );
      return;
    }

    if (!ctx.sel.ids.size) return;
    // per-entity highlight
    for (const id of ctx.sel.ids) {
      const e = this.ent(doc, id);
      if (!e) continue;
      if (e.kind === 'path') {
        g.appendChild(
          el('path', {
            d: pathD(e.vertices, e.closed),
            class: 'ov-sel',
            fill: 'none',
            'vector-effect': 'non-scaling-stroke',
          }),
        );
      } else {
        const b = entityBBox(doc, e);
        if (b)
          g.appendChild(
            el('rect', {
              x: b.minX,
              y: b.minY,
              width: b.maxX - b.minX,
              height: b.maxY - b.minY,
              class: 'ov-sel',
              fill: 'none',
              'vector-effect': 'non-scaling-stroke',
            }),
          );
      }
    }

    const single = ctx.sel.single;
    const singleEnt = single ? this.ent(doc, single) : null;

    // vertex + midpoint + radius handles for a single path
    if (singleEnt?.kind === 'path') {
      const vts = singleEnt.vertices;
      const hs = px(5);
      // midpoint handles insert a vertex; skip segments too short on screen
      const n = vts.length;
      const lastSeg = singleEnt.closed ? n : n - 1;
      for (let i = 0; i < lastSeg; i++) {
        const a = vts[i];
        const b = vts[(i + 1) % n];
        if (dist(a, b) < px(28)) continue;
        g.appendChild(
          el('circle', {
            cx: (a.x + b.x) / 2,
            cy: (a.y + b.y) / 2,
            r: px(4),
            class: 'ov-mid',
            'data-handle': `m:${i}`,
            'vector-effect': 'non-scaling-stroke',
          }),
        );
      }
      vts.forEach((p, i) => {
        g.appendChild(
          el('rect', {
            x: p.x - hs,
            y: p.y - hs,
            width: hs * 2,
            height: hs * 2,
            class:
              'ov-handle' +
              (this.vertexSel?.entId === single && this.vertexSel.idx === i ? ' active' : ''),
            'data-handle': `v:${i}`,
            'vector-effect': 'non-scaling-stroke',
          }),
        );
      });
      // radius handle for the active vertex
      const vs = this.vertexSel;
      if (vs && vs.entId === single && vts.length >= 3) {
        const n = vts.length;
        const i = vs.idx;
        const applicable = singleEnt.closed || (i > 0 && i < n - 1);
        if (applicable) {
          const cur = vts[i];
          const arc = cornerArc(vts, i, singleEnt.closed);
          let pos: Vec;
          if (arc) {
            const mid = norm(sub(cur, arc.center));
            pos = add(arc.center, mul(mid, arc.r));
          } else {
            const prev = vts[(i - 1 + n) % n];
            const next = vts[(i + 1) % n];
            const bis = norm(add(norm(sub(prev, cur)), norm(sub(next, cur))));
            pos = add(cur, mul(bis, px(16)));
          }
          g.appendChild(
            el('circle', {
              cx: pos.x,
              cy: pos.y,
              r: px(5),
              class: 'ov-radius',
              'data-handle': `r:${i}`,
              'vector-effect': 'non-scaling-stroke',
            }),
          );
        }
      }
    }

    // dimension endpoint handles
    if (singleEnt?.kind === 'dim') {
      const hs = px(5);
      for (const [which, p] of [
        ['dima', singleEnt.a],
        ['dimb', singleEnt.b],
      ] as const) {
        g.appendChild(
          el('rect', {
            x: p.x - hs,
            y: p.y - hs,
            width: hs * 2,
            height: hs * 2,
            class: 'ov-handle',
            'data-handle': which,
            'vector-effect': 'non-scaling-stroke',
          }),
        );
      }
    }

    // selection bbox + rotate handle
    const b = this.selectionBBox(doc);
    if (b && !(singleEnt?.kind === 'path')) {
      g.appendChild(
        el('rect', {
          x: b.minX,
          y: b.minY,
          width: b.maxX - b.minX,
          height: b.maxY - b.minY,
          class: 'ov-bbox',
          fill: 'none',
          'vector-effect': 'non-scaling-stroke',
        }),
      );
    }
    if (b && !(singleEnt?.kind === 'opening')) {
      const cx = (b.minX + b.maxX) / 2;
      const top = b.minY - px(26);
      g.appendChild(
        el('line', {
          x1: cx,
          y1: b.minY,
          x2: cx,
          y2: top,
          class: 'ov-bbox',
          'vector-effect': 'non-scaling-stroke',
        }),
      );
      g.appendChild(
        el('circle', {
          cx,
          cy: top,
          r: px(6),
          class: 'ov-rotate',
          'data-handle': 'rot',
          'vector-effect': 'non-scaling-stroke',
        }),
      );
    }
  }
}
