import './styles.css';
import { debounceTime } from 'rxjs';
import type { Doc, Entity, Vec } from './types';
import { emptyDoc, newId } from './types';
import { Store, Selection } from './store';
import { SettingsStore } from './settings';
import { ViewCtl } from './view';
import { buildScene, DARK_PALETTE, LIGHT_PALETTE, renderGrid } from './render';
import { docBBox } from './entity';
import { autosave, loadAutosave } from './io';
import type { Tool, ToolCtx, ToolDefaults, ToolId } from './tools/base';
import { SelectTool } from './tools/select';
import { DrawTool } from './tools/draw';
import { OpeningTool } from './tools/openings';
import { DimTool, TapeTool, AreaLabelTool } from './tools/measure';
import { PlaceTool, TextTool } from './tools/place';
import { buildUI, type UIHandles } from './ui';

const canvas = document.getElementById('canvas') as unknown as SVGSVGElement;
const worldG = document.getElementById('world') as unknown as SVGGElement;
const gridG = document.getElementById('grid') as unknown as SVGGElement;
const sceneG = document.getElementById('scene') as unknown as SVGGElement;
const overlayG = document.getElementById('overlay') as unknown as SVGGElement;
const hud = document.getElementById('hud')!;

const store = new Store();
const sel = new Selection();
const settings = new SettingsStore();
const view = new ViewCtl(canvas);

const defaults: ToolDefaults = {
  wallThickness: 15,
  wallAlign: 'edge',
  wallSide: 1,
  doorWidth: 80,
  windowWidth: 150,
  textSize: 22,
};

let ui: UIHandles | null = null;

const ctx: ToolCtx = {
  store,
  sel,
  settings,
  view,
  canvas,
  overlay: overlayG,
  hud,
  defaults,
  setTool: (id, opts) => setTool(id, opts),
  setHint: (t) => ui?.setHint(t),
  requestRender: () => requestRender(),
  editText: (ent, pos) => ui?.editText(ent, pos),
  uiRefresh: () => ui?.refresh(),
};

const selectTool = new SelectTool(ctx);
const tools: Record<ToolId, Tool> = {
  select: selectTool,
  wall: new DrawTool(ctx, 'wall'),
  line: new DrawTool(ctx, 'line'),
  rect: new DrawTool(ctx, 'rect'),
  polygon: new DrawTool(ctx, 'polygon'),
  door: new OpeningTool(ctx, 'door'),
  window: new OpeningTool(ctx, 'window'),
  dim: new DimTool(ctx),
  tape: new TapeTool(ctx),
  arealabel: new AreaLabelTool(ctx),
  text: new TextTool(ctx),
  place: new PlaceTool(ctx),
};

let activeTool: Tool = selectTool;

function setTool(id: ToolId, opts?: unknown): void {
  activeTool.deactivate?.();
  activeTool = tools[id];
  activeTool.activate?.(opts);
  canvas.dataset.tool = id;
  ui?.setHint(activeTool.hint);
  ui?.syncToolButtons();
  requestRender();
}

// ---- pointer routing --------------------------------------------------------

function toolEvent(e: PointerEvent) {
  return { raw: view.toWorld(e.clientX, e.clientY), e };
}

canvas.addEventListener('pointerdown', (e) => {
  if (view.spaceDown) return;
  canvas.setPointerCapture(e.pointerId);
  activeTool.down?.(toolEvent(e));
});
canvas.addEventListener('pointermove', (e) => {
  const w = view.toWorld(e.clientX, e.clientY);
  updateCoords(w);
  if (view.isPanning) return;
  activeTool.move?.({ raw: w, e });
});
canvas.addEventListener('pointerup', (e) => {
  activeTool.up?.(toolEvent(e));
});
canvas.addEventListener('dblclick', (e) => {
  activeTool.dbl?.({ raw: view.toWorld(e.clientX, e.clientY), e: e as unknown as PointerEvent });
});
canvas.addEventListener('contextmenu', (e) => e.preventDefault());

const coordsEl = document.getElementById('coords')!;
function updateCoords(w: Vec): void {
  const u = settings.value.unit;
  const f = (n: number) => (u === 'm' ? (n / 100).toFixed(2) : Math.round(n).toString());
  coordsEl.textContent = `${f(w.x)}, ${f(w.y)} ${u}`;
}

// ---- keyboard -----------------------------------------------------------------

const TOOL_KEYS: Record<string, ToolId> = {
  v: 'select',
  w: 'wall',
  l: 'line',
  r: 'rect',
  p: 'polygon',
  d: 'door',
  n: 'window',
  i: 'dim',
  m: 'tape',
  a: 'arealabel',
  t: 'text',
};

document.addEventListener('keydown', (e) => {
  const t = e.target as HTMLElement;
  if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT') return;
  if (document.querySelector('dialog[open]')) return;
  if (e.key === ' ') {
    view.spaceDown = true;
    canvas.classList.add('panning');
    e.preventDefault();
    return;
  }
  if (activeTool.key?.(e)) {
    e.preventDefault();
    return;
  }
  if (e.ctrlKey || e.metaKey) {
    const k = e.key.toLowerCase();
    if (k === 'z') {
      e.shiftKey ? store.redo() : store.undo();
      e.preventDefault();
    } else if (k === 'y') {
      store.redo();
      e.preventDefault();
    } else if (k === 'd') {
      duplicateSelection();
      e.preventDefault();
    } else if (k === 's') {
      import('./io').then((io) =>
        io.downloadFile(
          `${store.doc.name.replace(/[^\w\-. ]+/g, '') || 'floorplan'}.floorplan.json`,
          'application/json',
          io.serializeDoc(store.doc),
        ),
      );
      e.preventDefault();
    } else if (k === 'o') {
      import('./io').then(async (io) => {
        const text = await io.pickFile('.json,.floorplan,application/json');
        if (text) {
          try {
            loadDoc(io.parseDoc(text));
          } catch (err) {
            alert(`Could not open file: ${err instanceof Error ? err.message : err}`);
          }
        }
      });
      e.preventDefault();
    }
    return;
  }
  const key = e.key.toLowerCase();
  if (TOOL_KEYS[key]) {
    setTool(TOOL_KEYS[key]);
    return;
  }
  if (key === 'g') {
    settings.update({ showGrid: !settings.value.showGrid });
  } else if (key === '+' || key === '=') {
    view.zoomCenter(1.25);
  } else if (key === '-') {
    view.zoomCenter(1 / 1.25);
  } else if (key === '0') {
    fitView();
  } else if (e.key === 'F1' || key === '?') {
    ui?.openHelp();
    e.preventDefault();
  } else if (e.key === 'Escape' && activeTool.id !== 'select') {
    setTool('select');
  }
});
document.addEventListener('keyup', (e) => {
  if (e.key === ' ') {
    view.spaceDown = false;
    canvas.classList.remove('panning');
  }
});

// ---- edit operations ------------------------------------------------------------

function duplicateSelection(): void {
  const doc = store.doc;
  const ids = new Set(sel.ids);
  if (!ids.size) return;
  const idMap = new Map<string, string>();
  for (const id of ids) idMap.set(id, newId());
  const off = Math.max(20, settings.value.gridSize * 2);
  const clones: Entity[] = [];
  for (const e of doc.entities) {
    if (!ids.has(e.id)) continue;
    const nid = idMap.get(e.id)!;
    if (e.kind === 'opening') {
      const wid = idMap.get(e.wallId);
      if (!wid) continue; // opening without its wall makes no sense
      clones.push({ ...e, id: nid, wallId: wid });
    } else if (e.kind === 'arealabel') {
      const pid = idMap.get(e.pathId);
      if (!pid) continue;
      clones.push({ ...e, id: nid, pathId: pid, x: e.x + off, y: e.y + off });
    } else if (e.kind === 'path') {
      clones.push({
        ...e,
        id: nid,
        vertices: e.vertices.map((p) => ({ ...p, x: p.x + off, y: p.y + off })),
      });
    } else if (e.kind === 'dim') {
      clones.push({
        ...e,
        id: nid,
        a: { x: e.a.x + off, y: e.a.y + off },
        b: { x: e.b.x + off, y: e.b.y + off },
      });
    } else {
      clones.push({ ...e, id: nid, x: e.x + off, y: e.y + off });
    }
  }
  if (!clones.length) return;
  store.commit({ ...doc, entities: [...doc.entities, ...clones] });
  sel.set(clones.map((c) => c.id));
}

function fitView(): void {
  view.fit(docBBox(store.doc));
}

function loadDoc(doc: Doc): void {
  sel.clear();
  store.reset(doc);
  setTool('select');
  fitView();
}

// ---- render loop ------------------------------------------------------------------

let scheduled = false;
let lastDoc: Doc | null = null;
let lastSceneKey = '';

function requestRender(): void {
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(paint);
}

function paint(): void {
  scheduled = false;
  const v = view.view;
  worldG.setAttribute('transform', `translate(${v.x} ${v.y}) scale(${v.scale})`);
  const s = settings.value;
  const palette = s.theme === 'dark' ? DARK_PALETTE : LIGHT_PALETTE;
  const sceneKey = `${s.theme}|${s.unit}`;
  if (store.doc !== lastDoc || sceneKey !== lastSceneKey) {
    lastDoc = store.doc;
    lastSceneKey = sceneKey;
    sceneG.innerHTML = '';
    sceneG.appendChild(buildScene(store.doc, { palette, unit: s.unit, interactive: true }));
  }
  renderGrid(gridG, v, view.worldRect(), s.gridSize, s.showGrid, palette);
  activeTool.renderOverlay?.();
}

store.doc$.subscribe(() => requestRender());
sel.ids$.subscribe(() => requestRender());
view.view$.subscribe(() => requestRender());
settings.settings$.subscribe(() => requestRender());
window.addEventListener('resize', () => requestRender());

// autosave (debounced) — the working copy always survives a reload
store.doc$.pipe(debounceTime(800)).subscribe((doc) => autosave(doc));

// ---- boot -------------------------------------------------------------------------

function sampleDoc(): Doc {
  const doc = emptyDoc('Sample plan');
  const wallId = newId();
  doc.entities.push(
    {
      id: wallId,
      kind: 'path',
      layer: 'structure',
      closed: true,
      // drawn along the inner face; thickness grows outward (side -1)
      vertices: [
        { x: 0, y: 0 },
        { x: 500, y: 0 },
        { x: 500, y: 400 },
        { x: 0, y: 400 },
      ],
      wall: { thickness: 15, align: 'edge', side: -1 },
    },
    {
      id: newId(),
      kind: 'opening',
      layer: 'structure',
      opening: 'door',
      wallId,
      seg: 2,
      t: 110,
      width: 90,
      hinge: 1,
      swing: 1,
    },
    {
      id: newId(),
      kind: 'opening',
      layer: 'structure',
      opening: 'window',
      wallId,
      seg: 0,
      t: 250,
      width: 160,
      hinge: 1,
      swing: 1,
    },
    { id: newId(), kind: 'item', layer: 'furniture', item: 'sofa', x: 150, y: 90, w: 200, h: 90, rotation: 0, flip: false },
    { id: newId(), kind: 'item', layer: 'furniture', item: 'table_round', x: 360, y: 220, w: 110, h: 110, rotation: 0, flip: false },
    { id: newId(), kind: 'item', layer: 'electrical', item: 'outlet', x: 20, y: 200, w: 30, h: 30, rotation: 90, flip: false },
    { id: newId(), kind: 'arealabel', layer: 'annotations', pathId: wallId, name: 'Living room', x: 200, y: 240 },
    { id: newId(), kind: 'dim', layer: 'dimensions', a: { x: 0, y: 0 }, b: { x: 500, y: 0 }, offset: -70 },
  );
  return doc;
}

const boot = loadAutosave() ?? sampleDoc();
store.reset(boot);

const app = {
  store,
  sel,
  settings,
  view,
  defaults,
  selectTool,
  setTool,
  activeToolId: () => activeTool.id,
  newPlan: () => loadDoc(emptyDoc()),
  loadDoc,
  fitView,
  duplicateSelection,
  requestRender,
};

ui = buildUI(app);
document.documentElement.dataset.theme = settings.value.theme;
setTool('select');
fitView();
