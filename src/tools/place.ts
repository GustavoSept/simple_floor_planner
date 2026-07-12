import type { CustomItemDef, ItemEnt, LayerId } from '../types';
import { newId } from '../types';
import { el } from '../render';
import { SYMBOLS } from '../symbols';
import { pathD } from '../geom';
import { chip, clearOverlay, snapFree, type Tool, type ToolCtx, type ToolEvent } from './base';
import type { Vec } from '../types';

export interface PlaceOpts {
  item: string; // symbol key or 'custom:<id>'
  customDef?: CustomItemDef; // provided when placing a custom object
}

export class PlaceTool implements Tool {
  readonly id = 'place' as const;
  readonly hint = 'Click to place · R rotates · F flips · Esc/right-click for select tool';
  private item = 'sofa';
  private customDef: CustomItemDef | null = null;
  private rotation = 0;
  private flip = false;
  private cur: Vec | null = null;

  constructor(private ctx: ToolCtx) {}

  activate(opts?: unknown): void {
    const o = opts as PlaceOpts | undefined;
    if (o?.item) {
      this.item = o.item;
      this.customDef = o.customDef ?? null;
      this.rotation = 0;
      this.flip = false;
    }
    this.cur = null;
    clearOverlay(this.ctx);
  }

  deactivate(): void {
    clearOverlay(this.ctx);
  }

  private size(): { w: number; h: number } {
    if (this.customDef) return { w: this.customDef.w, h: this.customDef.h };
    const def = SYMBOLS[this.item];
    return def ? { w: def.w, h: def.h } : { w: 60, h: 60 };
  }

  private layer(): LayerId {
    const def = SYMBOLS[this.item];
    if (!def) return 'furniture';
    return def.cat === 'electrical' ? 'electrical' : def.cat === 'plumbing' ? 'plumbing' : 'furniture';
  }

  move(ev: ToolEvent): void {
    this.cur = snapFree(this.ctx, ev.raw, ev.e).p;
    this.draw();
  }

  down(ev: ToolEvent): void {
    if (ev.e.button === 2) {
      this.ctx.setTool('select');
      return;
    }
    if (ev.e.button !== 0) return;
    const p = snapFree(this.ctx, ev.raw, ev.e).p;
    const { w, h } = this.size();
    // custom defs must live inside the doc so saved files are self-contained
    if (this.customDef) {
      const doc = this.ctx.store.doc;
      if (!doc.customItems[this.customDef.id]) {
        this.ctx.store.commit({
          ...doc,
          customItems: { ...doc.customItems, [this.customDef.id]: this.customDef },
        });
      }
    }
    const ent: ItemEnt = {
      id: newId(),
      kind: 'item',
      layer: this.layer(),
      item: this.item,
      x: Math.round(p.x),
      y: Math.round(p.y),
      w,
      h,
      rotation: this.rotation,
      flip: this.flip,
    };
    this.ctx.store.addEntity(ent);
  }

  key(e: KeyboardEvent): boolean {
    if (e.key === 'Escape') {
      this.ctx.setTool('select');
      return true;
    }
    if (e.key === 'r' || e.key === 'R') {
      this.rotation = (this.rotation + 90) % 360;
      this.draw();
      return true;
    }
    if (e.key === 'f' || e.key === 'F') {
      this.flip = !this.flip;
      this.draw();
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
    if (!this.cur) return;
    const { w, h } = this.size();
    const g = el('g', {
      transform:
        `translate(${this.cur.x} ${this.cur.y}) rotate(${this.rotation})` +
        (this.flip ? ' scale(-1 1)' : ''),
      class: 'ov-ghost-item',
      fill: 'none',
      'stroke-width': 1.6,
    });
    const def = SYMBOLS[this.item];
    if (def) {
      g.innerHTML = def.draw(w, h);
    } else if (this.customDef) {
      for (const p of this.customDef.paths)
        g.appendChild(el('path', { d: pathD(p.vertices, p.closed) }));
    }
    ctx.overlay.appendChild(g);
    const name = def?.name ?? this.customDef?.name ?? this.item;
    chip(ctx, this.cur, name, 18, 24);
  }
}

/** Text tool: click to open the inline editor at that spot. */
export class TextTool implements Tool {
  readonly id = 'text' as const;
  readonly hint = 'Click where the text should go';

  constructor(private ctx: ToolCtx) {}

  down(ev: ToolEvent): void {
    if (ev.e.button !== 0) return;
    const p = snapFree(this.ctx, ev.raw, ev.e).p;
    this.ctx.editText(null, p);
    this.ctx.setTool('select');
  }

  key(e: KeyboardEvent): boolean {
    if (e.key === 'Escape') {
      this.ctx.setTool('select');
      return true;
    }
    return false;
  }
}
