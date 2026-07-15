import type { Doc, TextEnt, Vec } from '../types';
import type { Store, Selection } from '../store';
import type { SettingsStore } from '../settings';
import type { ViewCtl } from '../view';
import { parseLen } from '../geom';
import { el } from '../render';
import { snapMove, snapPoint, type AlignGuide, type SnapHit } from '../snap';

export type ToolId =
  | 'select'
  | 'wall'
  | 'line'
  | 'rect'
  | 'polygon'
  | 'door'
  | 'window'
  | 'dim'
  | 'tape'
  | 'angle'
  | 'arealabel'
  | 'text'
  | 'place';

export interface ToolDefaults {
  wallThickness: number;
  wallAlign: 'edge' | 'center';
  wallSide: 1 | -1;
  doorWidth: number;
  doorPadding: number; // cm, "batente" frame width added on each side of the door leaf
  windowWidth: number;
  textSize: number;
  dimPrecision: number; // decimal digits for new dimension lines
  tapePrecision: number; // decimal digits for the tape measure readout
  anglePrecision: number; // decimal digits for new angle measurements
}

export interface ToolCtx {
  store: Store;
  sel: Selection;
  settings: SettingsStore;
  view: ViewCtl;
  canvas: SVGSVGElement;
  overlay: SVGGElement; // world-space, above the scene
  hud: HTMLElement; // screen-space, above the canvas
  defaults: ToolDefaults;
  setTool(id: ToolId, opts?: unknown): void;
  setHint(text: string): void;
  requestRender(): void;
  /** Open the floating text editor; ent=null creates a new text at pos. */
  editText(ent: TextEnt | null, worldPos: Vec): void;
  /** Notify the UI that contextual state (active vertex, tool options) changed. */
  uiRefresh(): void;
}

export interface ToolEvent {
  raw: Vec; // unsnapped world position
  e: PointerEvent;
}

export interface Tool {
  readonly id: ToolId;
  readonly hint: string;
  activate?(opts?: unknown): void;
  deactivate?(): void;
  down?(ev: ToolEvent): void;
  move?(ev: ToolEvent): void;
  up?(ev: ToolEvent): void;
  dbl?(ev: ToolEvent): void;
  /** Return true when the event was consumed. */
  key?(e: KeyboardEvent): boolean;
  /** Redraw selection/preview overlay (called on every render pass). */
  renderOverlay?(): void;
}

/** Snap tolerance in world units (~10 px on screen). */
export function tol(ctx: ToolCtx): number {
  return 10 / ctx.view.view.scale;
}

export function snapFree(
  ctx: ToolCtx,
  raw: Vec,
  e?: PointerEvent,
  exclude?: ReadonlySet<string>,
  sticky?: string,
): SnapHit {
  return snapPoint(ctx.store.doc, raw, tol(ctx), ctx.settings.value, {
    off: e?.ctrlKey || e?.metaKey,
    exclude,
    sticky,
  });
}

/** Like `snapFree`, but Shift locks the point to the horizontal/vertical axis through `anchor`. */
export function snapMoveFree(
  ctx: ToolCtx,
  anchor: Vec,
  raw: Vec,
  e?: PointerEvent,
  exclude?: ReadonlySet<string>,
  sticky?: string,
): SnapHit {
  return snapMove(ctx.store.doc, anchor, raw, tol(ctx), ctx.settings.value, !!e?.shiftKey, {
    off: e?.ctrlKey || e?.metaKey,
    exclude,
    sticky,
  });
}

/** Buffer for typing an exact length while drawing. */
export class LenBuffer {
  s = '';

  /** Handle a key; returns true if consumed. */
  key(e: KeyboardEvent): boolean {
    if (e.ctrlKey || e.metaKey || e.altKey) return false;
    if (/^[0-9]$/.test(e.key) || e.key === '.' || e.key === ',') {
      this.s += e.key === ',' ? '.' : e.key;
      return true;
    }
    if (e.key === 'Backspace' && this.s) {
      this.s = this.s.slice(0, -1);
      return true;
    }
    return false;
  }

  cm(unit: 'm' | 'cm'): number | null {
    return this.s ? parseLen(this.s, unit) : null;
  }

  clear(): void {
    this.s = '';
  }
}

// ---- overlay drawing helpers (previews use non-scaling strokes) ----------

export function ovLine(g: SVGGElement, a: Vec, b: Vec, cls = 'ov-line'): void {
  g.appendChild(
    el('line', { x1: a.x, y1: a.y, x2: b.x, y2: b.y, class: cls, 'vector-effect': 'non-scaling-stroke' }),
  );
}

export function ovPath(g: SVGGElement, d: string, cls = 'ov-line'): void {
  g.appendChild(el('path', { d, class: cls, 'vector-effect': 'non-scaling-stroke', fill: 'none' }));
}

export function ovDot(g: SVGGElement, p: Vec, scale: number, cls = 'ov-dot'): void {
  g.appendChild(el('circle', { cx: p.x, cy: p.y, r: 4 / scale, class: cls }));
}

/** Snap indicator: small diamond at vertex snaps, circle at edge snaps. */
export function ovSnap(g: SVGGElement, hit: SnapHit, scale: number): void {
  if (hit.guide) {
    ovLine(g, hit.guide[0], hit.guide[1], 'ov-measure-guide');
  }
  if (hit.kind !== 'vertex' && hit.kind !== 'edge') return;
  const s = 6 / scale;
  if (hit.kind === 'vertex') {
    g.appendChild(
      el('path', {
        d: `M ${hit.p.x - s} ${hit.p.y} L ${hit.p.x} ${hit.p.y - s} L ${hit.p.x + s} ${hit.p.y} L ${hit.p.x} ${hit.p.y + s} Z`,
        class: 'ov-snap',
        'vector-effect': 'non-scaling-stroke',
        fill: 'none',
      }),
    );
  } else {
    g.appendChild(el('circle', { cx: hit.p.x, cy: hit.p.y, r: s, class: 'ov-snap', fill: 'none' }));
  }
}

/** Draw a full-viewport alignment guide line for one locked axis. */
export function ovAlignGuide(ctx: ToolCtx, guide: AlignGuide): void {
  const r = ctx.view.worldRect();
  if (guide.axis === 'x') {
    ovLine(ctx.overlay, { x: guide.value, y: r.minY }, { x: guide.value, y: r.maxY }, 'ov-align-guide');
  } else {
    ovLine(ctx.overlay, { x: r.minX, y: guide.value }, { x: r.maxX, y: guide.value }, 'ov-align-guide');
  }
}

/** Position a HUD chip near a world point; returns the chip element. */
export function chip(ctx: ToolCtx, world: Vec, text: string, dx = 14, dy = -18): void {
  const s = ctx.view.toScreen(world);
  const div = document.createElement('div');
  div.className = 'hud-chip';
  div.textContent = text;
  div.style.left = `${s.x + dx}px`;
  div.style.top = `${s.y + dy}px`;
  ctx.hud.appendChild(div);
}

export function clearHud(ctx: ToolCtx): void {
  ctx.hud.querySelectorAll('.hud-chip').forEach((n) => n.remove());
}

export function clearOverlay(ctx: ToolCtx): void {
  ctx.overlay.innerHTML = '';
  clearHud(ctx);
}

/** Is the entity's layer interactable (visible and unlocked)? */
export function editable(doc: Doc, entId: string): boolean {
  const e = doc.entities.find((x) => x.id === entId);
  if (!e) return false;
  const l = doc.layers[e.layer];
  return !!l && l.visible && !l.locked;
}
