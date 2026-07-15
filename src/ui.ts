import type {
  AngleEnt,
  AreaLabelEnt,
  CustomItemDef,
  DimEnt,
  Doc,
  ItemEnt,
  OpeningEnt,
  PathEnt,
  Settings,
  TextEnt,
  Vec,
} from './types';
import { LAYER_NAMES, LAYER_ORDER, newId } from './types';
import type { Store, Selection } from './store';
import type { SettingsStore } from './settings';
import type { ViewCtl } from './view';
import type { SelectTool } from './tools/select';
import type { ToolDefaults, ToolId } from './tools/base';
import { SYMBOLS, SYMBOL_CATS } from './symbols';
import { formatArea, formatLen, pathD, polylineLength, bboxOf } from './geom';
import { pathAreaCm2 } from './render';
import {
  deleteCustomItem,
  deletePlan,
  exportPNG,
  exportSVG,
  listCustomItems,
  listPlans,
  loadPlan,
  parseDoc,
  pickFile,
  printDoc,
  savePlan,
  savePlanByName,
  serializeDoc,
  downloadFile,
} from './io';
import type { PlaceOpts } from './tools/place';

export interface AppApi {
  store: Store;
  sel: Selection;
  settings: SettingsStore;
  view: ViewCtl;
  defaults: ToolDefaults;
  selectTool: SelectTool;
  setTool(id: ToolId, opts?: unknown): void;
  activeToolId(): ToolId;
  newPlan(): void;
  loadDoc(doc: Doc): void;
  fitView(): void;
  duplicateSelection(): void;
  requestRender(): void;
}

export interface UIHandles {
  refresh(): void;
  editText(ent: TextEnt | null, worldPos: Vec): void;
  setHint(text: string): void;
  syncToolButtons(): void;
  openHelp(): void;
}

const TOOL_BUTTONS: { id: ToolId; label: string; key: string; icon: string }[] = [
  { id: 'select', label: 'Select', key: 'V', icon: 'M3 1.5 L12.5 7.5 L8.2 8.6 L6.2 13.5 Z' },
  { id: 'wall', label: 'Wall', key: 'W', icon: 'M2 6 H14 M2 10 H14 M2 6 V10 M14 6 V10' },
  { id: 'line', label: 'Line', key: 'L', icon: 'M2.5 13.5 L13.5 2.5' },
  { id: 'rect', label: 'Rectangle', key: 'R', icon: 'M3 4 H13 V12 H3 Z' },
  { id: 'polygon', label: 'Polygon', key: 'P', icon: 'M8 2 L14 6.5 L11.5 13.5 L4.5 13.5 L2 6.5 Z' },
  { id: 'door', label: 'Door', key: 'D', icon: 'M3 13 H13 M4 13 V4 M4 4 A 9 9 0 0 1 13 13' },
  { id: 'window', label: 'Window', key: 'N', icon: 'M2 6 H14 V10 H2 Z M2 8 H14' },
  { id: 'dim', label: 'Dimension', key: 'I', icon: 'M3 4 V12 M13 4 V12 M3 8 H13 M5 6.5 L3 8 L5 9.5 M11 6.5 L13 8 L11 9.5' },
  { id: 'tape', label: 'Tape measure', key: 'M', icon: 'M2 6 H14 V11 H2 Z M5 6 V8.5 M8 6 V8.5 M11 6 V8.5' },
  { id: 'angle', label: 'Angle', key: 'K', icon: 'M3 13 V4 M3 13 H12.5 M3 9.5 A 3.5 3.5 0 0 0 6.5 13' },
  { id: 'arealabel', label: 'Area label', key: 'A', icon: 'M3 3 H13 V13 H3 Z M5.5 10.5 L8 5.5 L10.5 10.5 M6.5 9 H9.5' },
  { id: 'text', label: 'Text', key: 'T', icon: 'M4 3.5 H12 M8 3.5 V13' },
];

function iconSvg(d: string): string {
  return `<svg viewBox="0 0 16 16" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="${d}"/></svg>`;
}

function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string> = {},
  ...children: (HTMLElement | string)[]
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  for (const [k, val] of Object.entries(attrs)) {
    if (k === 'class') e.className = val;
    else e.setAttribute(k, val);
  }
  for (const c of children) e.append(c);
  return e;
}

export function buildUI(app: AppApi): UIHandles {
  const { store, sel, settings } = app;

  // ------- top bar ---------------------------------------------------------
  const toolbar = document.getElementById('toolbar')!;
  const toolBtns = new Map<ToolId, HTMLButtonElement>();
  for (const t of TOOL_BUTTONS) {
    const b = h('button', { class: 'tool-btn', title: `${t.label} (${t.key})` });
    b.innerHTML = iconSvg(t.icon);
    b.append(h('span', { class: 'tool-label' }, t.label));
    b.onclick = () => app.setTool(t.id);
    toolBtns.set(t.id, b);
    toolbar.appendChild(b);
  }

  const rightBar = document.getElementById('topbar-right')!;
  const nameInput = h('input', { class: 'plan-name', type: 'text', title: 'Plan name' });
  nameInput.value = store.doc.name;
  nameInput.onchange = () => {
    store.commit({ ...store.doc, name: nameInput.value || 'Untitled plan' });
  };

  const mkBtn = (html: string, title: string, fn: () => void, cls = 'bar-btn') => {
    const b = h('button', { class: cls, title });
    b.innerHTML = html;
    b.onclick = fn;
    return b;
  };

  const undoBtn = mkBtn(iconSvg('M6 3 L2.5 6.5 L6 10 M2.5 6.5 H10 A 3.5 3.5 0 0 1 10 13.5 H6'), 'Undo (Ctrl+Z)', () => store.undo());
  const redoBtn = mkBtn(iconSvg('M10 3 L13.5 6.5 L10 10 M13.5 6.5 H6 A 3.5 3.5 0 0 0 6 13.5 H10'), 'Redo (Ctrl+Y)', () => store.redo());
  const zoomOut = mkBtn(iconSvg('M3 8 H13'), 'Zoom out (-)', () => app.view.zoomCenter(1 / 1.25));
  const zoomLabel = h('span', { class: 'zoom-label', title: 'Zoom' }, '100%');
  const zoomIn = mkBtn(iconSvg('M3 8 H13 M8 3 V13'), 'Zoom in (+)', () => app.view.zoomCenter(1.25));
  const fitBtn = mkBtn(iconSvg('M2 6 V2 H6 M10 2 H14 V6 M14 10 V14 H10 M6 14 H2 V10'), 'Zoom to fit (0)', () => app.fitView());
  const themeBtn = mkBtn(iconSvg('M8 2 A 6 6 0 1 0 14 8 A 4.5 4.5 0 0 1 8 2'), 'Toggle dark mode', () =>
    settings.update({ theme: settings.value.theme === 'dark' ? 'light' : 'dark' }),
  );
  const helpBtn = mkBtn('<b>?</b>', 'Help & shortcuts (F1)', () => dlgHelp.showModal());

  // file menu
  const fileMenu = h('details', { class: 'menu' });
  const fileSummary = h('summary', {}, 'File');
  const menuItems = h('div', { class: 'menu-items' });
  const menuItem = (label: string, fn: () => void) => {
    const b = h('button', {}, label);
    b.onclick = () => {
      fileMenu.removeAttribute('open');
      fn();
    };
    menuItems.appendChild(b);
  };
  menuItem('New plan', () => {
    if (confirm('Start a new plan? Unsaved changes are kept in the browser autosave only.')) app.newPlan();
  });
  menuItem('Open file…', async () => {
    const text = await pickFile('.json,.floorplan,application/json');
    if (!text) return;
    try {
      app.loadDoc(parseDoc(text));
    } catch (err) {
      alert(`Could not open file: ${err instanceof Error ? err.message : err}`);
    }
  });
  menuItem('Save file (Ctrl+S)', () => {
    downloadFile(`${store.doc.name.replace(/[^\w\-. ]+/g, '') || 'floorplan'}.floorplan.json`, 'application/json', serializeDoc(store.doc));
    savePlanByName(store.doc); // keep the browser copy in sync with the file
  });
  menuItem('My plans (browser)…', () => {
    renderPlansDialog();
    dlgPlans.showModal();
  });
  menuItem('Export SVG', () => exportSVG(store.doc, settings.value));
  menuItem('Export PNG…', () => dlgExport.showModal());
  menuItem('Print to scale…', () => dlgPrint.showModal());
  menuItem('Settings…', () => {
    renderSettingsDialog();
    dlgSettings.showModal();
  });
  fileMenu.append(fileSummary, menuItems);
  document.addEventListener('click', (e) => {
    if (fileMenu.hasAttribute('open') && !fileMenu.contains(e.target as Node))
      fileMenu.removeAttribute('open');
  });

  rightBar.append(fileMenu, nameInput, undoBtn, redoBtn, zoomOut, zoomLabel, zoomIn, fitBtn, themeBtn, helpBtn);

  // ------- library ---------------------------------------------------------
  const libraryEl = document.getElementById('library')!;

  function symbolCard(key: string, name: string, w: number, hh: number, drawInner: string, onClick: () => void, onDelete?: () => void): HTMLElement {
    const card = h('div', { class: 'lib-card', title: `${name} (${w}×${hh} cm)` });
    const vb = Math.max(w, hh) * 1.25;
    card.innerHTML = `<svg viewBox="${-vb / 2} ${-vb / 2} ${vb} ${vb}" class="lib-preview" fill="none" stroke="currentColor" stroke-width="${vb / 30}">${drawInner}</svg>`;
    card.appendChild(h('span', { class: 'lib-name' }, name));
    if (onDelete) {
      const del = h('button', { class: 'lib-del', title: 'Remove from library' }, '×');
      del.onclick = (e) => {
        e.stopPropagation();
        onDelete();
      };
      card.appendChild(del);
    }
    card.onclick = onClick;
    void key;
    return card;
  }

  function renderLibrary(): void {
    libraryEl.innerHTML = '';
    libraryEl.appendChild(h('div', { class: 'panel-title' }, 'Library'));
    for (const { cat, label } of SYMBOL_CATS) {
      const sec = h('div', { class: 'lib-section' });
      sec.appendChild(h('div', { class: 'lib-cat' }, label));
      const grid = h('div', { class: 'lib-grid' });
      for (const [key, def] of Object.entries(SYMBOLS)) {
        if (def.cat !== cat) continue;
        grid.appendChild(
          symbolCard(key, def.name, def.w, def.h, def.draw(def.w, def.h), () =>
            app.setTool('place', { item: key } satisfies PlaceOpts),
          ),
        );
      }
      sec.appendChild(grid);
      libraryEl.appendChild(sec);
    }
    // custom objects
    const sec = h('div', { class: 'lib-section' });
    sec.appendChild(h('div', { class: 'lib-cat' }, 'My objects'));
    const grid = h('div', { class: 'lib-grid' });
    const customs = listCustomItems();
    for (const def of customs) {
      const inner = def.paths.map((p) => `<path d="${pathD(p.vertices, p.closed)}"/>`).join('');
      grid.appendChild(
        symbolCard(
          def.id,
          def.name,
          def.w,
          def.h,
          inner,
          () => app.setTool('place', { item: `custom:${def.id}`, customDef: def } satisfies PlaceOpts),
          () => {
            deleteCustomItem(def.id);
            renderLibrary();
          },
        ),
      );
    }
    sec.appendChild(grid);
    if (!customs.length)
      sec.appendChild(
        h('div', { class: 'lib-hint' }, 'Select drawn shapes and use “Save as object” to add reusable objects here.'),
      );
    libraryEl.appendChild(sec);
  }
  renderLibrary();

  // ------- properties panel ------------------------------------------------
  const propsEl = document.getElementById('props')!;

  const cmIn = (val: number) => {
    const s = settings.value;
    return s.unit === 'm' ? String(Math.round(val) / 100) : String(Math.round(val * 10) / 10);
  };
  const cmOut = (raw: string): number | null => {
    const n = parseFloat(raw.replace(',', '.'));
    if (!isFinite(n)) return null;
    return settings.value.unit === 'm' ? n * 100 : n;
  };

  function row(label: string, ...controls: (HTMLElement | string)[]): HTMLElement {
    return h('div', { class: 'prop-row' }, h('label', {}, label), h('div', { class: 'prop-ctl' }, ...controls));
  }

  function lenInput(value: number, onCommit: (cm: number) => void, opts?: { min?: number }): HTMLInputElement {
    const inp = h('input', { type: 'text', class: 'prop-input' });
    inp.value = cmIn(value);
    inp.onchange = () => {
      const cm = cmOut(inp.value);
      if (cm == null || (opts?.min != null && cm < opts.min)) {
        inp.value = cmIn(value);
        return;
      }
      onCommit(cm);
    };
    return inp;
  }

  function numInput(value: number, onCommit: (n: number) => void): HTMLInputElement {
    const inp = h('input', { type: 'text', class: 'prop-input' });
    inp.value = String(Math.round(value * 100) / 100);
    inp.onchange = () => {
      const n = parseFloat(inp.value.replace(',', '.'));
      if (!isFinite(n)) {
        inp.value = String(value);
        return;
      }
      onCommit(n);
    };
    return inp;
  }

  function precisionInput(value: number, onCommit: (n: number) => void): HTMLInputElement {
    const inp = h('input', { type: 'number', class: 'prop-input', min: '0', max: '6', step: '1' });
    inp.value = String(value);
    inp.onchange = () => {
      const n = Math.round(Number(inp.value));
      if (!isFinite(n) || n < 0 || n > 6) {
        inp.value = String(value);
        return;
      }
      onCommit(n);
    };
    return inp;
  }

  function textInput(value: string, onCommit: (s: string) => void): HTMLInputElement {
    const inp = h('input', { type: 'text', class: 'prop-input wide' });
    inp.value = value;
    inp.onchange = () => onCommit(inp.value);
    return inp;
  }

  function actionBtn(label: string, fn: () => void): HTMLButtonElement {
    const b = h('button', { class: 'prop-btn' }, label);
    b.onclick = fn;
    return b;
  }

  const unitSuffix = () => (settings.value.unit === 'm' ? 'm' : 'cm');

  function renderProps(): void {
    propsEl.innerHTML = '';
    propsEl.appendChild(h('div', { class: 'panel-title' }, 'Properties'));
    const doc = store.doc;
    const ids = [...sel.ids].filter((id) => doc.entities.some((e) => e.id === id));
    const toolId = app.activeToolId();

    if (ids.length === 0) {
      renderToolProps(toolId);
      return;
    }
    if (ids.length > 1) {
      propsEl.appendChild(h('div', { class: 'prop-info' }, `${ids.length} objects selected`));
      propsEl.appendChild(row('', actionBtn('Delete', () => {
        store.deleteEntities(new Set(ids));
        sel.clear();
        renderProps();
      })));
      maybeSaveAsObject(ids);
      return;
    }
    const ent = doc.entities.find((e) => e.id === ids[0])!;
    switch (ent.kind) {
      case 'path':
        renderPathProps(ent);
        break;
      case 'item':
        renderItemProps(ent);
        break;
      case 'opening':
        renderOpeningProps(ent);
        break;
      case 'text':
        renderTextProps(ent);
        break;
      case 'arealabel':
        renderAreaLabelProps(ent);
        break;
      case 'dim':
        propsEl.appendChild(h('div', { class: 'prop-info' }, 'Dimension line — drag it to change its offset; drag its endpoints to re-measure.'));
        propsEl.appendChild(
          row('Decimal places', precisionInput(ent.precision ?? 2, (n) => store.updateEntity<DimEnt>(ent.id, { precision: n }))),
        );
        break;
      case 'angle':
        propsEl.appendChild(h('div', { class: 'prop-info' }, 'Angle — drag the arc to resize it; drag the vertex or leg points to re-measure.'));
        propsEl.appendChild(
          row('Decimal places', precisionInput(ent.precision ?? 1, (n) => store.updateEntity<AngleEnt>(ent.id, { precision: n }))),
        );
        break;
    }
  }

  function renderToolProps(toolId: ToolId): void {
    const d = app.defaults;
    if (toolId === 'wall') {
      propsEl.appendChild(h('div', { class: 'prop-info' }, 'Wall drawing'));
      propsEl.appendChild(
        row(`Thickness (${unitSuffix()})`, lenInput(d.wallThickness, (cm) => (d.wallThickness = cm), { min: 1 })),
      );
      const alignSel = h('select', { class: 'prop-input' });
      alignSel.append(new Option('Drawn line = wall face', 'edge'), new Option('Drawn line = centerline', 'center'));
      alignSel.value = d.wallAlign;
      alignSel.onchange = () => {
        d.wallAlign = alignSel.value as 'edge' | 'center';
        renderProps();
      };
      propsEl.appendChild(row('Reference', alignSel));
      if (d.wallAlign === 'edge') {
        propsEl.appendChild(
          row('Thick side', actionBtn(d.wallSide === 1 ? 'Right of direction' : 'Left of direction', () => {
            d.wallSide = d.wallSide === 1 ? -1 : 1;
            renderProps();
          })),
        );
        propsEl.appendChild(
          h('div', { class: 'prop-hint' }, 'Draw along the face you care about (e.g. the inner room face); the thickness grows to the other side. Tab flips it while drawing.'),
        );
      }
      return;
    }
    if (toolId === 'door' || toolId === 'window') {
      propsEl.appendChild(h('div', { class: 'prop-info' }, toolId === 'door' ? 'Door placement' : 'Window placement'));
      const key = toolId === 'door' ? 'doorWidth' : 'windowWidth';
      propsEl.appendChild(row(`Width (${unitSuffix()})`, lenInput(d[key], (cm) => (d[key] = cm), { min: 20 })));
      if (toolId === 'door') {
        propsEl.appendChild(
          row(`Frame padding (${unitSuffix()})`, lenInput(d.doorPadding, (cm) => (d.doorPadding = cm), { min: 0 })),
        );
        propsEl.appendChild(
          h('div', { class: 'prop-hint' }, 'Batente added on each side of the leaf, so the wall opening is wider than the door itself.'),
        );
      }
      return;
    }
    if (toolId === 'text') {
      propsEl.appendChild(row(`Text size (${unitSuffix()})`, lenInput(d.textSize, (cm) => (d.textSize = cm), { min: 5 })));
      return;
    }
    if (toolId === 'dim') {
      propsEl.appendChild(h('div', { class: 'prop-info' }, 'Dimension line'));
      propsEl.appendChild(
        row('Decimal places', precisionInput(d.dimPrecision, (n) => (d.dimPrecision = n))),
      );
      propsEl.appendChild(h('div', { class: 'prop-hint' }, 'Applied to new dimension lines; each one can be adjusted afterward.'));
      return;
    }
    if (toolId === 'tape') {
      propsEl.appendChild(h('div', { class: 'prop-info' }, 'Tape measure'));
      propsEl.appendChild(
        row('Decimal places', precisionInput(d.tapePrecision, (n) => (d.tapePrecision = n))),
      );
      return;
    }
    if (toolId === 'angle') {
      propsEl.appendChild(h('div', { class: 'prop-info' }, 'Angle measurement'));
      propsEl.appendChild(
        row('Decimal places', precisionInput(d.anglePrecision, (n) => (d.anglePrecision = n))),
      );
      return;
    }
    propsEl.appendChild(h('div', { class: 'prop-info dim' }, 'Nothing selected'));
  }

  function maybeSaveAsObject(ids: string[]): void {
    const doc = store.doc;
    const paths = ids
      .map((id) => doc.entities.find((e) => e.id === id))
      .filter((e): e is PathEnt => !!e && e.kind === 'path' && !e.wall);
    if (!paths.length) return;
    propsEl.appendChild(
      row('', actionBtn('Save as object', () => {
        const name = prompt('Object name:', 'My object');
        if (!name) return;
        const all = paths.flatMap((p) => p.vertices);
        const b = bboxOf(all);
        const cx = (b.minX + b.maxX) / 2;
        const cy = (b.minY + b.maxY) / 2;
        const def: CustomItemDef = {
          id: newId(),
          name,
          w: Math.max(1, Math.round(b.maxX - b.minX)),
          h: Math.max(1, Math.round(b.maxY - b.minY)),
          paths: paths.map((p) => ({
            closed: p.closed,
            vertices: p.vertices.map((v0) => ({ x: v0.x - cx, y: v0.y - cy, r: v0.r })),
          })),
        };
        import('./io').then((io) => {
          io.saveCustomItem(def);
          renderLibrary();
        });
      })),
    );
  }

  function renderPathProps(ent: PathEnt): void {
    const isWall = !!ent.wall;
    propsEl.appendChild(h('div', { class: 'prop-info' }, isWall ? 'Wall' : ent.closed ? 'Shape' : 'Polyline'));
    const wallToggle = h('input', { type: 'checkbox' });
    wallToggle.checked = isWall;
    wallToggle.onchange = () => {
      store.updateEntity<PathEnt>(ent.id, {
        wall: wallToggle.checked
          ? { thickness: app.defaults.wallThickness, align: app.defaults.wallAlign, side: app.defaults.wallSide }
          : undefined,
      });
      renderProps();
    };
    propsEl.appendChild(row('Wall', wallToggle));
    if (ent.wall) {
      propsEl.appendChild(
        row(`Thickness (${unitSuffix()})`, lenInput(ent.wall.thickness, (cm) =>
          store.updateEntity<PathEnt>(ent.id, { wall: { ...ent.wall!, thickness: cm } }), { min: 1 })),
      );
      const alignSel = h('select', { class: 'prop-input' });
      alignSel.append(new Option('Drawn line = wall face', 'edge'), new Option('Drawn line = centerline', 'center'));
      alignSel.value = ent.wall.align;
      alignSel.onchange = () =>
        store.updateEntity<PathEnt>(ent.id, { wall: { ...ent.wall!, align: alignSel.value as 'edge' | 'center' } });
      propsEl.appendChild(row('Reference', alignSel));
      if (ent.wall.align === 'edge')
        propsEl.appendChild(
          row('Thick side', actionBtn('Flip to other side', () =>
            store.updateEntity<PathEnt>(ent.id, { wall: { ...ent.wall!, side: ent.wall!.side === 1 ? -1 : 1 } }))),
        );
    }
    const unit = settings.value.unit;
    propsEl.appendChild(
      h('div', { class: 'prop-info dim' },
        `${ent.vertices.length} vertices · ${isWall ? 'reference line ' : ''}length ${formatLen(polylineLength(ent.vertices, ent.closed), unit)}`),
    );
    if (ent.closed) {
      const area = pathAreaCm2(ent);
      if (area != null)
        propsEl.appendChild(h('div', { class: 'prop-info dim' }, `${isWall ? 'Inner area' : 'Area'}: ${formatArea(area)}`));
    }
    // active vertex
    const vs = app.selectTool.vertexSel;
    if (vs && vs.entId === ent.id && ent.vertices[vs.idx]) {
      const v0 = ent.vertices[vs.idx];
      propsEl.appendChild(h('div', { class: 'prop-sub' }, `Vertex ${vs.idx + 1}`));
      const patchVertex = (patch: Partial<typeof v0>) => {
        const vertices = ent.vertices.map((q, i) => (i === vs.idx ? { ...q, ...patch } : q));
        store.updateEntity<PathEnt>(ent.id, { vertices });
      };
      propsEl.appendChild(row(`X (${unitSuffix()})`, lenInput(v0.x, (cm) => patchVertex({ x: cm }))));
      propsEl.appendChild(row(`Y (${unitSuffix()})`, lenInput(v0.y, (cm) => patchVertex({ y: cm }))));
      propsEl.appendChild(
        row(`Corner radius (${unitSuffix()})`, lenInput(v0.r ?? 0, (cm) => patchVertex({ r: cm > 0 ? cm : undefined }), { min: 0 })),
      );
      propsEl.appendChild(row('', actionBtn('Delete vertex', () => app.selectTool.deleteVertex(ent.id, vs.idx))));
      propsEl.appendChild(h('div', { class: 'prop-hint' }, 'Drag the round handle near the corner to round it (Illustrator-style).'));
    }
    if (!isWall) maybeSaveAsObject([ent.id]);
  }

  function renderItemProps(ent: ItemEnt): void {
    const def = SYMBOLS[ent.item];
    const custom = ent.item.startsWith('custom:') ? store.doc.customItems[ent.item.slice(7)] : undefined;
    propsEl.appendChild(h('div', { class: 'prop-info' }, def?.name ?? custom?.name ?? 'Object'));
    const labelInp = textInput(ent.label ?? '', (s) =>
      store.updateEntity<ItemEnt>(ent.id, { label: s.trim() ? s : undefined }),
    );
    labelInp.placeholder = def?.name ?? custom?.name ?? '';
    propsEl.appendChild(row('Label', labelInp));
    propsEl.appendChild(row(`Width (${unitSuffix()})`, lenInput(ent.w, (cm) => store.updateEntity<ItemEnt>(ent.id, { w: cm }), { min: 1 })));
    propsEl.appendChild(row(`Depth (${unitSuffix()})`, lenInput(ent.h, (cm) => store.updateEntity<ItemEnt>(ent.id, { h: cm }), { min: 1 })));
    propsEl.appendChild(row('Rotation (°)', numInput(ent.rotation, (n) => store.updateEntity<ItemEnt>(ent.id, { rotation: n }))));
    propsEl.appendChild(row('', actionBtn(ent.flip ? 'Unmirror (F)' : 'Mirror (F)', () => store.updateEntity<ItemEnt>(ent.id, { flip: !ent.flip }))));
  }

  function renderOpeningProps(ent: OpeningEnt): void {
    propsEl.appendChild(h('div', { class: 'prop-info' }, ent.opening === 'door' ? 'Door' : 'Window'));
    propsEl.appendChild(row(`Width (${unitSuffix()})`, lenInput(ent.width, (cm) => store.updateEntity<OpeningEnt>(ent.id, { width: cm }), { min: 10 })));
    if (ent.opening === 'door') {
      propsEl.appendChild(
        row(
          `Frame padding (${unitSuffix()})`,
          lenInput(ent.padding ?? 0, (cm) => store.updateEntity<OpeningEnt>(ent.id, { padding: cm > 0 ? cm : undefined }), { min: 0 }),
        ),
      );
      propsEl.appendChild(
        h('div', { class: 'prop-hint' }, `Batente added on each side of the leaf. Total wall opening: ${formatLen(ent.width + (ent.padding ?? 0) * 2, settings.value.unit)}.`),
      );
      propsEl.appendChild(row('', actionBtn('Flip swing side (F)', () => store.updateEntity<OpeningEnt>(ent.id, { swing: ent.swing === 1 ? -1 : 1 }))));
      propsEl.appendChild(row('', actionBtn('Flip hinge end (H)', () => store.updateEntity<OpeningEnt>(ent.id, { hinge: ent.hinge === 1 ? -1 : 1 }))));
    }
    propsEl.appendChild(h('div', { class: 'prop-hint' }, 'Drag the opening to slide it along the wall (or onto another wall).'));
  }

  function renderTextProps(ent: TextEnt): void {
    propsEl.appendChild(h('div', { class: 'prop-info' }, 'Text'));
    const ta = h('textarea', { class: 'prop-textarea' });
    ta.value = ent.text;
    ta.onchange = () => store.updateEntity<TextEnt>(ent.id, { text: ta.value });
    propsEl.appendChild(row('Text', ta));
    propsEl.appendChild(row(`Size (${unitSuffix()})`, lenInput(ent.size, (cm) => store.updateEntity<TextEnt>(ent.id, { size: cm }), { min: 5 })));
  }

  function renderAreaLabelProps(ent: AreaLabelEnt): void {
    propsEl.appendChild(h('div', { class: 'prop-info' }, 'Area label'));
    propsEl.appendChild(row('Name', textInput(ent.name, (s) => store.updateEntity<AreaLabelEnt>(ent.id, { name: s }))));
    const path = store.doc.entities.find((e) => e.id === ent.pathId);
    if (path?.kind === 'path') {
      const area = pathAreaCm2(path);
      if (area != null) propsEl.appendChild(h('div', { class: 'prop-info dim' }, `Area: ${formatArea(area)}`));
    }
  }

  // ------- layers panel ----------------------------------------------------
  const layersEl = document.getElementById('layers')!;
  function renderLayers(): void {
    layersEl.innerHTML = '';
    layersEl.appendChild(h('div', { class: 'panel-title' }, 'Layers'));
    const doc = store.doc;
    for (const l of LAYER_ORDER) {
      const st = doc.layers[l];
      const rowEl = h('div', { class: 'layer-row' });
      const eye = h('button', { class: 'layer-btn' + (st.visible ? ' on' : ''), title: 'Show/hide' });
      eye.innerHTML = iconSvg(st.visible ? 'M1.5 8 C 4 4.5 12 4.5 14.5 8 C 12 11.5 4 11.5 1.5 8 Z M8 8 m -1.8 0 a 1.8 1.8 0 1 0 3.6 0 a 1.8 1.8 0 1 0 -3.6 0' : 'M1.5 8 C 4 4.5 12 4.5 14.5 8 M3 11 L2 13 M8 12 V14 M13 11 L14 13');
      eye.onclick = () => store.setLayer(l, { visible: !st.visible });
      const lock = h('button', { class: 'layer-btn' + (st.locked ? ' on' : ''), title: 'Lock/unlock' });
      lock.innerHTML = iconSvg(st.locked ? 'M4 7 H12 V13 H4 Z M6 7 V5 A 2 2 0 0 1 10 5 V7' : 'M4 7 H12 V13 H4 Z M6 7 V5 A 2 2 0 0 1 10 5');
      lock.onclick = () => store.setLayer(l, { locked: !st.locked });
      rowEl.append(eye, lock, h('span', { class: 'layer-name' + (st.visible ? '' : ' off') }, LAYER_NAMES[l]));
      layersEl.appendChild(rowEl);
    }
  }

  // ------- status bar ------------------------------------------------------
  const hintEl = document.getElementById('hint')!;
  const togglesEl = document.getElementById('status-toggles')!;
  function renderToggles(): void {
    togglesEl.innerHTML = '';
    const s = settings.value;
    const mk = (label: string, on: boolean, fn: () => void, title: string) => {
      const b = h('button', { class: 'chip-toggle' + (on ? ' on' : ''), title }, label);
      b.onclick = fn;
      togglesEl.appendChild(b);
    };
    const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
    const mkCycle = <K extends 'alignSnap' | 'measureSnap'>(
      prefix: string,
      key: K,
      modes: readonly Settings[K][],
      title: string,
    ) => {
      const cur = s[key];
      const idx = modes.indexOf(cur);
      const b = h(
        'button',
        { class: 'chip-toggle' + (cur !== modes[0] ? ' on' : ''), title },
        `${prefix}: ${cap(String(cur))}`,
      );
      b.onclick = () => settings.update({ [key]: modes[(idx + 1) % modes.length] } as Partial<Settings>);
      togglesEl.appendChild(b);
    };
    mk('Grid', s.showGrid, () => settings.update({ showGrid: !s.showGrid }), 'Show grid (G)');
    mk('Grid snap', s.snapGrid, () => settings.update({ snapGrid: !s.snapGrid }), 'Snap to grid');
    mk('Object snap', s.snapObjects, () => settings.update({ snapObjects: !s.snapObjects }), 'Snap to vertices & edges (hold Ctrl to disable temporarily)');
    mk('Angle', s.snapAngle, () => settings.update({ snapAngle: !s.snapAngle }), 'Constrain drawing to 15° steps');
    mkCycle('Align', 'alignSnap', ['off', 'immediate', 'close', 'all'] as const, "Same-object X/Y alignment guides — click to cycle off/immediate/close/all");
    mkCycle('Measure', 'measureSnap', ['off', 'vertex', 'all'] as const, 'Snap to dimension lines — click to cycle off/vertex/all');
    const unitBtn = h('button', { class: 'chip-toggle on', title: 'Display unit' }, s.unit === 'm' ? 'meters' : 'centimeters');
    unitBtn.onclick = () => settings.update({ unit: s.unit === 'm' ? 'cm' : 'm' });
    togglesEl.appendChild(unitBtn);
  }

  // ------- dialogs ---------------------------------------------------------
  const dlgSettings = document.getElementById('dlg-settings') as HTMLDialogElement;
  const dlgPlans = document.getElementById('dlg-plans') as HTMLDialogElement;
  const dlgExport = document.getElementById('dlg-export') as HTMLDialogElement;
  const dlgPrint = document.getElementById('dlg-print') as HTMLDialogElement;
  const dlgHelp = document.getElementById('dlg-help') as HTMLDialogElement;

  function dlgFrame(dlg: HTMLDialogElement, title: string): HTMLElement {
    dlg.innerHTML = '';
    const head = h('div', { class: 'dlg-head' }, h('b', {}, title));
    const close = h('button', { class: 'dlg-close', title: 'Close' }, '×');
    close.onclick = () => dlg.close();
    head.appendChild(close);
    dlg.appendChild(head);
    const body = h('div', { class: 'dlg-body' });
    dlg.appendChild(body);
    return body;
  }

  function renderSettingsDialog(): void {
    const body = dlgFrame(dlgSettings, 'Settings');
    const s = settings.value;
    const unitSel = h('select', {});
    unitSel.append(new Option('meters', 'm'), new Option('centimeters', 'cm'));
    unitSel.value = s.unit;
    unitSel.onchange = () => settings.update({ unit: unitSel.value as 'm' | 'cm' });
    body.appendChild(row('Display unit', unitSel));
    const gridSel = h('select', {});
    for (const g of [1, 5, 10, 20, 25, 50, 100]) gridSel.append(new Option(`${g} cm`, String(g)));
    gridSel.value = String(s.gridSize);
    gridSel.onchange = () => settings.update({ gridSize: parseInt(gridSel.value, 10) });
    body.appendChild(row('Grid step', gridSel));
    const chk = (label: string, key: 'showGrid' | 'snapGrid' | 'snapObjects' | 'snapAngle') => {
      const c = h('input', { type: 'checkbox' });
      c.checked = settings.value[key];
      c.onchange = () => settings.update({ [key]: c.checked });
      body.appendChild(row(label, c));
    };
    chk('Show grid', 'showGrid');
    chk('Snap to grid', 'snapGrid');
    chk('Snap to objects', 'snapObjects');
    chk('Angle snap (15°)', 'snapAngle');
    const alignSel = h('select', {});
    alignSel.append(new Option('Off', 'off'), new Option('Immediate neighbors', 'immediate'), new Option('Close (≤4 hops)', 'close'), new Option('All vertices', 'all'));
    alignSel.value = s.alignSnap;
    alignSel.onchange = () => settings.update({ alignSnap: alignSel.value as Settings['alignSnap'] });
    body.appendChild(row('Align snap', alignSel));
    body.appendChild(h('div', { class: 'prop-hint' }, 'While drawing or dragging a vertex, snaps to the X/Y of other vertices in the same object.'));
    const measureSel = h('select', {});
    measureSel.append(new Option('Off', 'off'), new Option('Endpoints only', 'vertex'), new Option('Anywhere on the line', 'all'));
    measureSel.value = s.measureSnap;
    measureSel.onchange = () => settings.update({ measureSnap: measureSel.value as Settings['measureSnap'] });
    body.appendChild(row('Measure snap', measureSel));
    body.appendChild(h('div', { class: 'prop-hint' }, 'Snaps to existing dimension lines, highlighted in red while active.'));
  }

  function renderPlansDialog(): void {
    const body = dlgFrame(dlgPlans, 'My plans (stored in this browser)');
    const saveBtn = actionBtn('Save current plan', () => {
      savePlan(store.doc);
      renderPlansDialog();
    });
    body.appendChild(h('div', { class: 'dlg-row' }, saveBtn));
    const plans = listPlans();
    if (!plans.length) body.appendChild(h('div', { class: 'prop-info dim' }, 'No saved plans yet.'));
    for (const p of plans) {
      const rowEl = h('div', { class: 'plan-row' });
      rowEl.appendChild(h('span', { class: 'plan-title' }, p.name));
      rowEl.appendChild(h('span', { class: 'plan-date' }, new Date(p.updated).toLocaleString()));
      const open = actionBtn('Open', () => {
        const d = loadPlan(p.id);
        if (d) {
          app.loadDoc(d);
          dlgPlans.close();
        }
      });
      const overwrite = actionBtn('Overwrite', () => {
        if (confirm(`Overwrite “${p.name}” with the current plan?`)) {
          savePlan(store.doc, p.id);
          renderPlansDialog();
        }
      });
      const del = actionBtn('Delete', () => {
        if (confirm(`Delete “${p.name}”?`)) {
          deletePlan(p.id);
          renderPlansDialog();
        }
      });
      rowEl.append(open, overwrite, del);
      body.appendChild(rowEl);
    }
  }

  {
    const body = dlgFrame(dlgExport, 'Export PNG');
    const resSel = h('select', {});
    resSel.append(new Option('Standard (2 px/cm)', '2'), new Option('High (4 px/cm)', '4'), new Option('Very high (8 px/cm)', '8'));
    resSel.value = '4';
    body.appendChild(row('Resolution', resSel));
    body.appendChild(
      h('div', { class: 'dlg-row' }, actionBtn('Export', async () => {
        dlgExport.close();
        await exportPNG(store.doc, settings.value, parseInt(resSel.value, 10));
      })),
    );
  }

  {
    const body = dlgFrame(dlgPrint, 'Print to scale');
    const scaleSel = h('select', {});
    for (const d of [20, 50, 100, 200]) scaleSel.append(new Option(`1:${d}`, String(d)));
    scaleSel.value = '50';
    body.appendChild(row('Scale', scaleSel));
    body.appendChild(h('div', { class: 'prop-hint' }, 'In the print dialog, set margins to none/minimum and scale to 100% so dimensions stay true. Large plans may span multiple pages.'));
    body.appendChild(
      h('div', { class: 'dlg-row' }, actionBtn('Print', () => {
        dlgPrint.close();
        printDoc(store.doc, settings.value, parseInt(scaleSel.value, 10));
      })),
    );
  }

  {
    const body = dlgFrame(dlgHelp, 'Help & shortcuts');
    const rows: [string, string][] = [
      ['V / W / L / R / P', 'Select · Wall · Line · Rectangle · Polygon'],
      ['D / N', 'Door · Window (hover a wall, click to place)'],
      ['I / M / A / T', 'Dimension · Tape measure · Area label · Text'],
      ['While drawing', 'Type a number + Enter for an exact length · Tab flips wall side · C closes · Esc cancels'],
      ['Mouse', 'Wheel zooms · middle-drag or Space+drag pans'],
      ['Add vertex', 'Select a shape, then drag the small ○ at an edge midpoint — or double-click the edge'],
      ['Selection', 'Shift+click adds · drag on empty space for marquee · Del deletes · Ctrl+D duplicates'],
      ['Q / E', 'Rotate selection 90° · drag the round top handle for free rotation (Alt = unsnapped)'],
      ['F / H', 'Mirror item / flip door swing · flip door hinge'],
      ['Arrows', 'Nudge selection by one grid step (Shift = 1 cm)'],
      ['Ctrl+Z / Ctrl+Y', 'Undo · Redo'],
      ['Ctrl+S / Ctrl+O', 'Save file · Open file'],
      ['G / 0 / + / −', 'Toggle grid · zoom to fit · zoom'],
      ['Ctrl (held)', 'Temporarily disable snapping'],
      ['Corner rounding', 'Select a shape, click a vertex, drag the small round handle — or set an exact radius in Properties'],
      ['Walls', 'Draw along the inner or outer face (see Properties while the Wall tool is active); dimensions snap to wall faces, so you always measure the face you care about'],
    ];
    const table = h('table', { class: 'help-table' });
    for (const [k, txt] of rows) {
      table.appendChild(h('tr', {}, h('td', { class: 'help-key' }, k), h('td', {}, txt)));
    }
    body.appendChild(table);
  }

  // ------- inline text editor ----------------------------------------------
  const hud = document.getElementById('hud')!;
  function editText(ent: TextEnt | null, worldPos: Vec): void {
    const s = app.view.toScreen(worldPos);
    const ta = h('textarea', { class: 'text-editor' });
    ta.value = ent?.text ?? '';
    ta.style.left = `${s.x}px`;
    ta.style.top = `${s.y - 14}px`;
    hud.appendChild(ta);
    ta.focus();
    let done = false;
    const commit = () => {
      if (done) return;
      done = true;
      const text = ta.value.trim();
      ta.remove();
      if (ent) {
        if (text) store.updateEntity<TextEnt>(ent.id, { text });
        else store.deleteEntities(new Set([ent.id]));
      } else if (text) {
        const ne: TextEnt = {
          id: newId(),
          kind: 'text',
          layer: 'annotations',
          x: Math.round(worldPos.x),
          y: Math.round(worldPos.y),
          text,
          size: app.defaults.textSize,
        };
        store.addEntity(ne);
        sel.set([ne.id]);
      }
    };
    ta.onblur = commit;
    ta.onkeydown = (e) => {
      e.stopPropagation();
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        commit();
      }
      if (e.key === 'Escape') {
        done = true;
        ta.remove();
      }
    };
  }

  // ------- subscriptions -----------------------------------------------------
  sel.ids$.subscribe(() => renderProps());
  settings.settings$.subscribe(() => {
    renderToggles();
    document.documentElement.dataset.theme = settings.value.theme;
    renderProps();
  });
  store.doc$.subscribe((doc) => {
    renderLayers();
    if (document.activeElement && propsEl.contains(document.activeElement)) return;
    renderProps();
    if (document.activeElement !== nameInput) nameInput.value = doc.name;
  });
  app.view.view$.subscribe((v) => {
    zoomLabel.textContent = `${Math.round(v.scale * 100)}%`;
  });

  function syncToolButtons(): void {
    const active = app.activeToolId();
    for (const [id, b] of toolBtns) b.classList.toggle('active', id === active);
    renderProps();
  }

  return {
    refresh: () => renderProps(),
    editText,
    setHint: (t: string) => {
      hintEl.textContent = t;
    },
    syncToolButtons,
    openHelp: () => dlgHelp.showModal(),
  };
}
