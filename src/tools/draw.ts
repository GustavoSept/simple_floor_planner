import type { PathEnt, Vec, Vertex } from '../types';
import { newId } from '../types';
import { dist, formatLen, offsetPolyline, pathD, wallOffsets } from '../geom';
import { snapDraw, pointAtDistance, type SnapHit } from '../snap';
import {
  chip,
  clearOverlay,
  LenBuffer,
  ovDot,
  ovPath,
  ovSnap,
  snapFree,
  tol,
  type Tool,
  type ToolCtx,
  type ToolEvent,
} from './base';

type DrawMode = 'line' | 'rect' | 'polygon' | 'wall';

const HINTS: Record<DrawMode, string> = {
  line: 'Click two points. Type a number for an exact length · Esc cancels',
  rect: 'Click two opposite corners · Esc cancels',
  polygon:
    'Click to add points · click the first point or press C to close · Enter/double-click finishes open · type a number for an exact length',
  wall:
    'Click to draw the wall along a face · Tab flips the thick side · C closes · Enter finishes · type a number for an exact length',
};

export class DrawTool implements Tool {
  readonly hint: string;
  private pts: Vertex[] = [];
  private cursor: SnapHit | null = null;
  private buf = new LenBuffer();

  constructor(
    private ctx: ToolCtx,
    readonly id: DrawMode,
  ) {
    this.hint = HINTS[id];
  }

  activate(): void {
    this.reset();
  }

  deactivate(): void {
    this.reset();
  }

  private reset(): void {
    this.pts = [];
    this.cursor = null;
    this.buf.clear();
    clearOverlay(this.ctx);
  }

  private snapAt(ev: ToolEvent): SnapHit {
    const ctx = this.ctx;
    if (this.pts.length === 0) return snapFree(ctx, ev.raw, ev.e);
    return snapDraw(ctx.store.doc, this.pts[this.pts.length - 1], ev.raw, tol(ctx), ctx.settings.value, {
      off: ev.e.ctrlKey || ev.e.metaKey,
    });
  }

  down(ev: ToolEvent): void {
    if (ev.e.button !== 0) return;
    const hit = this.snapAt(ev);
    this.cursor = hit;
    this.addPoint(hit.p);
  }

  private addPoint(p: Vec): void {
    const t = tol(this.ctx);
    if (this.pts.length > 0 && dist(p, this.pts[this.pts.length - 1]) < t / 2) return;
    if (this.id === 'line' && this.pts.length === 1) {
      this.commit([this.pts[0], { ...p }], false);
      return;
    }
    if (this.id === 'rect' && this.pts.length === 1) {
      const a = this.pts[0];
      this.commit(
        [a, { x: p.x, y: a.y }, { x: p.x, y: p.y }, { x: a.x, y: p.y }].map((q) => ({ ...q })),
        true,
      );
      return;
    }
    if ((this.id === 'polygon' || this.id === 'wall') && this.pts.length >= 3 && dist(p, this.pts[0]) < t) {
      this.commit(this.pts, true);
      return;
    }
    this.pts.push({ x: p.x, y: p.y });
    this.buf.clear();
    this.draw();
  }

  move(ev: ToolEvent): void {
    this.cursor = this.snapAt(ev);
    this.draw();
  }

  dbl(_ev: ToolEvent): void {
    if (this.id !== 'polygon' && this.id !== 'wall') return;
    // the double-click's second click already added a duplicate point
    if (this.pts.length >= 3) this.pts.pop();
    this.finishOpen();
  }

  key(e: KeyboardEvent): boolean {
    if (e.key === 'Escape') {
      if (this.pts.length) {
        this.reset();
        return true;
      }
      return false;
    }
    if (e.key === 'Tab' && this.id === 'wall') {
      this.ctx.defaults.wallSide = this.ctx.defaults.wallSide === 1 ? -1 : 1;
      this.ctx.uiRefresh();
      this.draw();
      return true;
    }
    if (this.pts.length > 0) {
      if (this.buf.key(e)) {
        this.draw();
        return true;
      }
      if (e.key === 'Enter') {
        const cm = this.buf.cm(this.ctx.settings.value.unit);
        if (cm && cm > 0 && this.cursor) {
          const p = pointAtDistance(
            this.pts[this.pts.length - 1],
            this.cursor.p,
            cm,
            this.ctx.settings.value.snapAngle,
          );
          this.buf.clear();
          this.addPoint(p);
        } else if (this.id === 'polygon' || this.id === 'wall') {
          this.finishOpen();
        }
        return true;
      }
      if (e.key === 'Backspace') {
        this.pts.pop();
        this.draw();
        return true;
      }
      if ((e.key === 'c' || e.key === 'C') && (this.id === 'polygon' || this.id === 'wall')) {
        if (this.pts.length >= 3) this.commit(this.pts, true);
        return true;
      }
    }
    return false;
  }

  private finishOpen(): void {
    if (this.pts.length >= 2) this.commit(this.pts, false);
    else this.reset();
  }

  private commit(vts: Vertex[], closed: boolean): void {
    const ctx = this.ctx;
    const ent: PathEnt = {
      id: newId(),
      kind: 'path',
      layer: 'structure',
      vertices: vts.map((p) => ({ x: round2(p.x), y: round2(p.y), r: p.r })),
      closed,
      wall:
        this.id === 'wall'
          ? {
              thickness: ctx.defaults.wallThickness,
              align: ctx.defaults.wallAlign,
              side: ctx.defaults.wallSide,
            }
          : undefined,
    };
    ctx.store.addEntity(ent);
    this.reset();
  }

  renderOverlay(): void {
    this.draw();
  }

  private draw(): void {
    const ctx = this.ctx;
    clearOverlay(ctx);
    const g = ctx.overlay;
    const scale = ctx.view.view.scale;
    if (this.cursor) ovSnap(g, this.cursor, scale);
    if (this.pts.length === 0) return;
    const cur = this.cursor?.p ?? this.pts[this.pts.length - 1];
    let previewPts: Vertex[];
    let closedPreview = false;
    if (this.id === 'rect') {
      const a = this.pts[0];
      previewPts = [a, { x: cur.x, y: a.y }, { x: cur.x, y: cur.y }, { x: a.x, y: cur.y }];
      closedPreview = true;
    } else {
      previewPts = [...this.pts, { x: cur.x, y: cur.y }];
    }
    ovPath(g, pathD(previewPts, closedPreview), 'ov-line');
    if (this.id === 'wall') {
      // show both faces of the wall being drawn
      const w = {
        thickness: ctx.defaults.wallThickness,
        align: ctx.defaults.wallAlign,
        side: ctx.defaults.wallSide,
      } as const;
      const o = wallOffsets(w);
      for (const off of [o.faceA, o.faceB]) {
        if (off === 0) continue;
        ovPath(g, pathD(offsetPolyline(previewPts, off, false), false), 'ov-ghost');
      }
    }
    ovDot(g, this.pts[0], scale);
    // live length / typed-length chip
    const last = this.pts[this.pts.length - 1];
    const unit = ctx.settings.value.unit;
    if (this.id === 'rect') {
      const a = this.pts[0];
      chip(ctx, cur, `${formatLen(Math.abs(cur.x - a.x), unit)} × ${formatLen(Math.abs(cur.y - a.y), unit)}`);
    } else {
      const typed = this.buf.s ? `  ⌨ ${this.buf.s} ${unit}` : '';
      chip(ctx, cur, formatLen(dist(last, cur), unit) + typed);
    }
  }
}

const round2 = (n: number) => Math.round(n * 100) / 100;
