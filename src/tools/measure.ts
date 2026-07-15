import type { AreaLabelEnt, DimEnt, PathEnt, Vec } from '../types';
import { newId } from '../types';
import {
  dist,
  dot,
  flattenPath,
  formatArea,
  formatLen,
  norm,
  pathD,
  perp,
  pointInPolygon,
  polygonArea,
  sub,
  wallInnerFace,
} from '../geom';
import { el } from '../render';
import {
  chip,
  clearOverlay,
  ovLine,
  ovSnap,
  snapFree,
  snapMoveFree,
  type Tool,
  type ToolCtx,
  type ToolEvent,
} from './base';
import type { SnapHit } from '../snap';

/** Temporary tape measure: click/drag two points; nothing is created. */
export class TapeTool implements Tool {
  readonly id = 'tape' as const;
  readonly hint = 'Click or drag two points to measure · Esc clears';
  private a: Vec | null = null;
  private cur: SnapHit | null = null;
  private done = false;

  constructor(private ctx: ToolCtx) {}

  deactivate(): void {
    this.reset();
  }

  private reset(): void {
    this.a = null;
    this.cur = null;
    this.done = false;
    clearOverlay(this.ctx);
  }

  down(ev: ToolEvent): void {
    if (ev.e.button !== 0) return;
    const hit = snapFree(this.ctx, ev.raw, ev.e);
    if (!this.a || this.done) {
      this.a = hit.p;
      this.done = false;
    } else {
      this.done = true;
    }
    this.cur = hit;
    this.draw();
  }

  move(ev: ToolEvent): void {
    if (this.done) return;
    this.cur = this.a ? snapMoveFree(this.ctx, this.a, ev.raw, ev.e) : snapFree(this.ctx, ev.raw, ev.e);
    this.draw();
  }

  up(ev: ToolEvent): void {
    if (this.a && !this.done && this.cur && dist(this.a, this.cur.p) > 2) {
      // drag gesture: finish on release
      this.cur = snapMoveFree(this.ctx, this.a, ev.raw, ev.e);
      this.done = true;
      this.draw();
    }
  }

  key(e: KeyboardEvent): boolean {
    if (e.key === 'Escape') {
      if (this.a) {
        this.reset();
        return true;
      }
      return false;
    }
    return false;
  }

  renderOverlay(): void {
    this.draw();
  }

  private draw(): void {
    const ctx = this.ctx;
    clearOverlay(ctx);
    if (this.cur) ovSnap(ctx.overlay, this.cur, ctx.view.view.scale);
    if (!this.a || !this.cur) return;
    ovLine(ctx.overlay, this.a, this.cur.p, 'ov-tape');
    const mid = { x: (this.a.x + this.cur.p.x) / 2, y: (this.a.y + this.cur.p.y) / 2 };
    chip(ctx, mid, formatLen(dist(this.a, this.cur.p), ctx.settings.value.unit, ctx.defaults.tapePrecision));
  }
}

/** Permanent dimension line: point A, point B, then offset. */
export class DimTool implements Tool {
  readonly id = 'dim' as const;
  readonly hint =
    'Click the two points to measure (wall faces snap), then click to place the line · Esc restarts';
  private a: Vec | null = null;
  private b: Vec | null = null;
  private cur: SnapHit | null = null;
  private offset = 30;

  constructor(private ctx: ToolCtx) {}

  deactivate(): void {
    this.reset();
  }

  private reset(): void {
    this.a = null;
    this.b = null;
    this.cur = null;
    clearOverlay(this.ctx);
  }

  down(ev: ToolEvent): void {
    if (ev.e.button !== 0) return;
    const hit = this.a ? snapMoveFree(this.ctx, this.a, ev.raw, ev.e) : snapFree(this.ctx, ev.raw, ev.e);
    if (!this.a) {
      this.a = hit.p;
    } else if (!this.b) {
      if (dist(hit.p, this.a) < 1) return;
      this.b = hit.p;
    } else {
      const ent: DimEnt = {
        id: newId(),
        kind: 'dim',
        layer: 'dimensions',
        a: this.a,
        b: this.b,
        offset: this.offset,
        precision: this.ctx.defaults.dimPrecision,
      };
      this.ctx.store.addEntity(ent);
      this.reset();
    }
    this.draw();
  }

  move(ev: ToolEvent): void {
    this.cur =
      this.a && !this.b ? snapMoveFree(this.ctx, this.a, ev.raw, ev.e) : snapFree(this.ctx, ev.raw, ev.e);
    if (this.a && this.b) {
      const dir = norm(sub(this.b, this.a));
      this.offset = Math.round(dot(sub(ev.raw, this.a), perp(dir)));
    }
    this.draw();
  }

  key(e: KeyboardEvent): boolean {
    if (e.key === 'Escape' && (this.a || this.b)) {
      this.reset();
      return true;
    }
    return false;
  }

  renderOverlay(): void {
    this.draw();
  }

  private draw(): void {
    const ctx = this.ctx;
    clearOverlay(ctx);
    if (this.cur) ovSnap(ctx.overlay, this.cur, ctx.view.view.scale);
    if (!this.a) return;
    const end = this.b ?? this.cur?.p;
    if (!end) return;
    const dir = norm(sub(end, this.a));
    const n = perp(dir);
    const off = this.b ? this.offset : 0;
    const A = { x: this.a.x + n.x * off, y: this.a.y + n.y * off };
    const B = { x: end.x + n.x * off, y: end.y + n.y * off };
    ovLine(ctx.overlay, A, B, 'ov-tape');
    if (off) {
      ovLine(ctx.overlay, this.a, A, 'ov-ghost');
      ovLine(ctx.overlay, end, B, 'ov-ghost');
    }
    const mid = { x: (A.x + B.x) / 2, y: (A.y + B.y) / 2 };
    chip(ctx, mid, formatLen(dist(this.a, end), ctx.settings.value.unit, ctx.defaults.dimPrecision));
  }
}

/** Click inside a closed shape to attach a name + computed area label. */
export class AreaLabelTool implements Tool {
  readonly id = 'arealabel' as const;
  readonly hint = 'Click inside a closed shape (or closed wall) to label its area · Esc for select';
  private hoverPath: PathEnt | null = null;

  constructor(private ctx: ToolCtx) {}

  deactivate(): void {
    clearOverlay(this.ctx);
  }

  private findRoom(p: Vec): PathEnt | null {
    const doc = this.ctx.store.doc;
    let best: PathEnt | null = null;
    let bestArea = Infinity;
    for (const e of doc.entities) {
      if (e.kind !== 'path' || !e.closed || e.vertices.length < 3) continue;
      if (!doc.layers[e.layer]?.visible) continue;
      const poly = flattenPath(e.wall ? wallInnerFace(e) : e.vertices, true);
      if (pointInPolygon(poly, p)) {
        const area = polygonArea(poly);
        if (area < bestArea) {
          bestArea = area;
          best = e;
        }
      }
    }
    return best;
  }

  move(ev: ToolEvent): void {
    this.hoverPath = this.findRoom(ev.raw);
    this.draw(ev.raw);
  }

  down(ev: ToolEvent): void {
    if (ev.e.button !== 0) return;
    const path = this.findRoom(ev.raw);
    if (!path) return;
    const count = this.ctx.store.doc.entities.filter((e) => e.kind === 'arealabel').length;
    const ent: AreaLabelEnt = {
      id: newId(),
      kind: 'arealabel',
      layer: 'annotations',
      pathId: path.id,
      name: `Room ${count + 1}`,
      x: Math.round(ev.raw.x),
      y: Math.round(ev.raw.y),
    };
    this.ctx.store.addEntity(ent);
    this.ctx.sel.set([ent.id]);
    this.ctx.setTool('select');
    this.ctx.uiRefresh();
  }

  key(e: KeyboardEvent): boolean {
    if (e.key === 'Escape') {
      this.ctx.setTool('select');
      return true;
    }
    return false;
  }

  private draw(at?: Vec): void {
    const ctx = this.ctx;
    clearOverlay(ctx);
    if (!this.hoverPath) return;
    const poly = this.hoverPath.wall ? wallInnerFace(this.hoverPath) : this.hoverPath.vertices;
    ctx.overlay.appendChild(
      el('path', {
        d: pathD(poly, true),
        class: 'ov-room',
        'vector-effect': 'non-scaling-stroke',
      }),
    );
    if (at) {
      const area = polygonArea(flattenPath(poly, true));
      chip(ctx, at, formatArea(area));
    }
  }
}
