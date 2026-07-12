import type { OpeningEnt } from '../types';
import { newId } from '../types';
import { add, dist, mul, norm, perp, sub } from '../geom';
import { nearestWallPlacement, type WallPlacement } from '../entity';
import { el } from '../render';
import { chip, clearOverlay, tol, type Tool, type ToolCtx, type ToolEvent } from './base';

export class OpeningTool implements Tool {
  readonly hint: string;
  private hover: WallPlacement | null = null;
  private hoverSide: 1 | -1 = 1;
  private lastPlaced: string | null = null;

  constructor(
    private ctx: ToolCtx,
    readonly id: 'door' | 'window',
  ) {
    this.hint =
      id === 'door'
        ? 'Hover a wall and click to place · door swings toward your cursor side · F flips swing, H flips hinge (last placed)'
        : 'Hover a wall and click to place the window';
  }

  activate(): void {
    this.hover = null;
    this.lastPlaced = null;
    clearOverlay(this.ctx);
  }

  deactivate(): void {
    clearOverlay(this.ctx);
  }

  private width(): number {
    return this.id === 'door' ? this.ctx.defaults.doorWidth : this.ctx.defaults.windowWidth;
  }

  move(ev: ToolEvent): void {
    const pl = nearestWallPlacement(this.ctx.store.doc, ev.raw, tol(this.ctx) * 3);
    this.hover = pl;
    if (pl) this.hoverSide = pl.side;
    this.draw();
  }

  down(ev: ToolEvent): void {
    if (ev.e.button !== 0 || !this.hover) return;
    const pl = this.hover;
    const ent: OpeningEnt = {
      id: newId(),
      kind: 'opening',
      layer: pl.wall.layer,
      opening: this.id,
      wallId: pl.wall.id,
      seg: pl.seg,
      t: Math.round(pl.t),
      width: this.width(),
      hinge: 1,
      swing: this.hoverSide,
    };
    this.ctx.store.addEntity(ent);
    this.lastPlaced = ent.id;
  }

  key(e: KeyboardEvent): boolean {
    if (e.key === 'Escape') {
      this.ctx.setTool('select');
      return true;
    }
    if (!this.lastPlaced || this.id !== 'door') return false;
    const ent = this.ctx.store.getEntity(this.lastPlaced);
    if (!ent || ent.kind !== 'opening') return false;
    if (e.key === 'f' || e.key === 'F') {
      this.ctx.store.updateEntity<OpeningEnt>(ent.id, { swing: ent.swing === 1 ? -1 : 1 });
      return true;
    }
    if (e.key === 'h' || e.key === 'H') {
      this.ctx.store.updateEntity<OpeningEnt>(ent.id, { hinge: ent.hinge === 1 ? -1 : 1 });
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
    if (!this.hover) {
      ctx.setHint(this.hint);
      return;
    }
    const pl = this.hover;
    const centerA = pl.q;
    const width = this.width();
    // ghost rectangle across the wall
    const wall = pl.wall.wall!;
    const segDir = this.segDir(pl);
    const n = perp(segDir);
    const hw = width / 2;
    const ht = wall.thickness / 2;
    const c = centerA;
    const pts = [
      add(add(c, mul(segDir, -hw)), mul(n, -ht)),
      add(add(c, mul(segDir, hw)), mul(n, -ht)),
      add(add(c, mul(segDir, hw)), mul(n, ht)),
      add(add(c, mul(segDir, -hw)), mul(n, ht)),
    ];
    ctx.overlay.appendChild(
      el('polygon', {
        points: pts.map((p) => `${p.x},${p.y}`).join(' '),
        class: 'ov-ghost-fill',
        'vector-effect': 'non-scaling-stroke',
      }),
    );
    chip(ctx, c, `${this.id === 'door' ? 'Door' : 'Window'} ${Math.round(width)} cm`);
  }

  private segDir(pl: WallPlacement) {
    const wallEnt = pl.wall;
    const center = wallEnt.vertices; // direction only; reference line is parallel to centerline
    const nv = center.length;
    const a = center[pl.seg];
    const b = center[(pl.seg + 1) % nv];
    return dist(a, b) < 1e-6 ? { x: 1, y: 0 } : norm(sub(b, a));
  }
}
