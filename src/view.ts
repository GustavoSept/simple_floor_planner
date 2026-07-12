import { BehaviorSubject } from 'rxjs';
import type { Vec } from './types';
import type { BBox } from './geom';

export interface ViewState {
  x: number; // screen px offset of world origin
  y: number;
  scale: number; // px per cm
}

/** Pan/zoom controller for the main SVG canvas. */
export class ViewCtl {
  readonly view$ = new BehaviorSubject<ViewState>({ x: 80, y: 80, scale: 0.75 });
  spaceDown = false;
  private panning: { sx: number; sy: number; ox: number; oy: number } | null = null;

  constructor(private el: SVGSVGElement) {
    el.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });
    el.addEventListener('pointerdown', (e) => {
      if (e.button === 1 || (e.button === 0 && this.spaceDown)) {
        e.preventDefault();
        e.stopPropagation();
        const v = this.view$.value;
        this.panning = { sx: e.clientX, sy: e.clientY, ox: v.x, oy: v.y };
        el.setPointerCapture(e.pointerId);
      }
    }, { capture: true });
    el.addEventListener('pointermove', (e) => {
      if (!this.panning) return;
      e.stopPropagation();
      const v = this.view$.value;
      this.view$.next({
        ...v,
        x: this.panning.ox + (e.clientX - this.panning.sx),
        y: this.panning.oy + (e.clientY - this.panning.sy),
      });
    }, { capture: true });
    const endPan = (e: PointerEvent) => {
      if (this.panning) {
        e.stopPropagation();
        this.panning = null;
      }
    };
    el.addEventListener('pointerup', endPan, { capture: true });
    el.addEventListener('pointercancel', endPan, { capture: true });
  }

  get isPanning(): boolean {
    return this.panning !== null;
  }

  get view(): ViewState {
    return this.view$.value;
  }

  toWorld(clientX: number, clientY: number): Vec {
    const r = this.el.getBoundingClientRect();
    const v = this.view;
    return { x: (clientX - r.left - v.x) / v.scale, y: (clientY - r.top - v.y) / v.scale };
  }

  toScreen(p: Vec): Vec {
    const v = this.view;
    return { x: p.x * v.scale + v.x, y: p.y * v.scale + v.y };
  }

  /** Visible world rectangle. */
  worldRect(): BBox {
    const r = this.el.getBoundingClientRect();
    const v = this.view;
    return {
      minX: -v.x / v.scale,
      minY: -v.y / v.scale,
      maxX: (r.width - v.x) / v.scale,
      maxY: (r.height - v.y) / v.scale,
    };
  }

  private onWheel(e: WheelEvent): void {
    e.preventDefault();
    const factor = Math.exp(-e.deltaY * 0.0012);
    this.zoomAt(e.clientX, e.clientY, factor);
  }

  zoomAt(clientX: number, clientY: number, factor: number): void {
    const r = this.el.getBoundingClientRect();
    const v = this.view;
    const scale = Math.min(12, Math.max(0.04, v.scale * factor));
    const px = clientX - r.left;
    const py = clientY - r.top;
    const wx = (px - v.x) / v.scale;
    const wy = (py - v.y) / v.scale;
    this.view$.next({ scale, x: px - wx * scale, y: py - wy * scale });
  }

  zoomCenter(factor: number): void {
    const r = this.el.getBoundingClientRect();
    this.zoomAt(r.left + r.width / 2, r.top + r.height / 2, factor);
  }

  fit(b: BBox | null): void {
    const r = this.el.getBoundingClientRect();
    if (!b || !isFinite(b.minX) || b.maxX - b.minX < 1) {
      // nothing drawn: show ~10m across
      const scale = Math.min(r.width, r.height) / 1000;
      this.view$.next({ scale, x: r.width / 2 - 500 * scale, y: r.height / 2 - 400 * scale });
      return;
    }
    const pad = 60; // px
    const w = b.maxX - b.minX;
    const h = b.maxY - b.minY;
    const scale = Math.min(12, Math.max(0.04, Math.min((r.width - pad * 2) / w, (r.height - pad * 2) / h)));
    this.view$.next({
      scale,
      x: (r.width - w * scale) / 2 - b.minX * scale,
      y: (r.height - h * scale) / 2 - b.minY * scale,
    });
  }
}
