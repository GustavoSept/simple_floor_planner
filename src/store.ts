import { BehaviorSubject } from 'rxjs';
import type { Doc, Entity, LayerId, Vertex } from './types';
import { emptyDoc } from './types';
import { setWallVertices } from './entity';

const HISTORY_LIMIT = 100;

/**
 * Single-document store. `preview` updates without touching history (used
 * during drags); `commit` finalizes a state and pushes the previous committed
 * state onto the undo stack.
 */
export class Store {
  readonly doc$ = new BehaviorSubject<Doc>(emptyDoc());
  private committed: Doc = this.doc$.value;
  private past: Doc[] = [];
  private future: Doc[] = [];

  get doc(): Doc {
    return this.doc$.value;
  }

  /** Update the visible doc without recording history (drag previews). */
  preview(doc: Doc): void {
    this.doc$.next(doc);
  }

  /** Discard any preview and restore the last committed state. */
  cancelPreview(): void {
    if (this.doc$.value !== this.committed) this.doc$.next(this.committed);
  }

  /** Commit a new state (undoable). */
  commit(doc: Doc): void {
    if (doc === this.committed) return;
    this.past.push(this.committed);
    if (this.past.length > HISTORY_LIMIT) this.past.shift();
    this.future = [];
    this.committed = doc;
    this.doc$.next(doc);
  }

  /** Replace the document and clear history (load/new). */
  reset(doc: Doc): void {
    this.past = [];
    this.future = [];
    this.committed = doc;
    this.doc$.next(doc);
  }

  undo(): void {
    const prev = this.past.pop();
    if (!prev) return;
    this.future.push(this.committed);
    this.committed = prev;
    this.doc$.next(prev);
  }

  redo(): void {
    const next = this.future.pop();
    if (!next) return;
    this.past.push(this.committed);
    this.committed = next;
    this.doc$.next(next);
  }

  get canUndo(): boolean {
    return this.past.length > 0;
  }
  get canRedo(): boolean {
    return this.future.length > 0;
  }

  // ---- convenience mutations (all commit) --------------------------------

  addEntity(ent: Entity): void {
    const d = this.doc;
    this.commit({ ...d, entities: [...d.entities, ent] });
  }

  updateEntity<T extends Entity>(id: string, patch: Partial<T>, opts?: { preview?: boolean }): void {
    const d = this.doc;
    const entities = d.entities.map((e) => (e.id === id ? ({ ...e, ...patch } as Entity) : e));
    const doc = { ...d, entities };
    if (opts?.preview) this.preview(doc);
    else this.commit(doc);
  }

  /**
   * Replace a path's vertices. For walls this re-anchors any openings so they
   * keep their world position (segment indices shift on vertex insert/delete).
   */
  updatePathVertices(wallId: string, vertices: Vertex[], opts?: { preview?: boolean }): void {
    const d = this.doc;
    const doc = { ...d, entities: setWallVertices(d.entities, wallId, vertices) };
    if (opts?.preview) this.preview(doc);
    else this.commit(doc);
  }

  /** Delete entities plus anything that references them (openings on walls, area labels on paths). */
  deleteEntities(ids: Set<string>): void {
    const d = this.doc;
    const gone = new Set(ids);
    let changed = true;
    while (changed) {
      changed = false;
      for (const e of d.entities) {
        if (gone.has(e.id)) continue;
        if (
          (e.kind === 'opening' && gone.has(e.wallId)) ||
          (e.kind === 'arealabel' && gone.has(e.pathId))
        ) {
          gone.add(e.id);
          changed = true;
        }
      }
    }
    this.commit({ ...d, entities: d.entities.filter((e) => !gone.has(e.id)) });
  }

  getEntity(id: string): Entity | undefined {
    return this.doc.entities.find((e) => e.id === id);
  }

  setLayer(layer: LayerId, patch: Partial<{ visible: boolean; locked: boolean }>): void {
    const d = this.doc;
    this.commit({ ...d, layers: { ...d.layers, [layer]: { ...d.layers[layer], ...patch } } });
  }
}

/** Selection as a separate observable (not part of undo history). */
export class Selection {
  readonly ids$ = new BehaviorSubject<ReadonlySet<string>>(new Set());

  get ids(): ReadonlySet<string> {
    return this.ids$.value;
  }
  set(ids: Iterable<string>): void {
    this.ids$.next(new Set(ids));
  }
  clear(): void {
    if (this.ids$.value.size) this.ids$.next(new Set());
  }
  toggle(id: string): void {
    const s = new Set(this.ids$.value);
    if (s.has(id)) s.delete(id);
    else s.add(id);
    this.ids$.next(s);
  }
  has(id: string): boolean {
    return this.ids$.value.has(id);
  }
  get single(): string | null {
    return this.ids$.value.size === 1 ? [...this.ids$.value][0] : null;
  }
}
