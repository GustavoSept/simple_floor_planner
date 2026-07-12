import type { CustomItemDef, Doc, Settings } from './types';
import { emptyDoc, LAYER_ORDER } from './types';
import { bboxPad, type BBox } from './geom';
import { docBBox } from './entity';
import { buildScene, el, LIGHT_PALETTE, PRINT_PALETTE, SVG_NS } from './render';

// ---- file serialization ---------------------------------------------------

export function serializeDoc(doc: Doc): string {
  return JSON.stringify(doc, null, 2);
}

/** Parse + minimally validate a plan file; throws on garbage. */
export function parseDoc(json: string): Doc {
  const raw = JSON.parse(json);
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.entities))
    throw new Error('Not a floor plan file');
  const base = emptyDoc(typeof raw.name === 'string' ? raw.name : 'Imported plan');
  const layers = { ...base.layers };
  if (raw.layers && typeof raw.layers === 'object') {
    for (const l of LAYER_ORDER) {
      if (raw.layers[l]) layers[l] = { visible: !!raw.layers[l].visible, locked: !!raw.layers[l].locked };
    }
  }
  return {
    ...base,
    name: base.name,
    entities: raw.entities,
    layers,
    customItems: raw.customItems && typeof raw.customItems === 'object' ? raw.customItems : {},
  };
}

export function downloadFile(name: string, mime: string, data: string | Blob): void {
  const blob = typeof data === 'string' ? new Blob([data], { type: mime }) : data;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export function pickFile(accept: string): Promise<string | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.onchange = () => {
      const f = input.files?.[0];
      if (!f) return resolve(null);
      const r = new FileReader();
      r.onload = () => resolve(String(r.result));
      r.onerror = () => resolve(null);
      r.readAsText(f);
    };
    input.click();
  });
}

// ---- localStorage plans -----------------------------------------------------

export interface PlanMeta {
  id: string;
  name: string;
  updated: number;
}

const PLANS_KEY = 'sfp.plans';
const PLAN_PREFIX = 'sfp.plan.';
const AUTOSAVE_KEY = 'sfp.autosave';
const CUSTOM_KEY = 'sfp.customItems';

export function listPlans(): PlanMeta[] {
  try {
    const raw = localStorage.getItem(PLANS_KEY);
    const list = raw ? (JSON.parse(raw) as PlanMeta[]) : [];
    return list.sort((a, b) => b.updated - a.updated);
  } catch {
    return [];
  }
}

export function savePlan(doc: Doc, id?: string): PlanMeta {
  const meta: PlanMeta = {
    id: id ?? `p${Date.now().toString(36)}`,
    name: doc.name,
    updated: Date.now(),
  };
  const list = listPlans().filter((p) => p.id !== meta.id);
  list.push(meta);
  localStorage.setItem(PLANS_KEY, JSON.stringify(list));
  localStorage.setItem(PLAN_PREFIX + meta.id, serializeDoc(doc));
  return meta;
}

/** Upsert by plan name — used when saving to file so the browser copy stays in sync. */
export function savePlanByName(doc: Doc): PlanMeta {
  const existing = listPlans().find((p) => p.name === doc.name);
  return savePlan(doc, existing?.id);
}

export function loadPlan(id: string): Doc | null {
  const raw = localStorage.getItem(PLAN_PREFIX + id);
  if (!raw) return null;
  try {
    return parseDoc(raw);
  } catch {
    return null;
  }
}

export function deletePlan(id: string): void {
  localStorage.setItem(PLANS_KEY, JSON.stringify(listPlans().filter((p) => p.id !== id)));
  localStorage.removeItem(PLAN_PREFIX + id);
}

export function autosave(doc: Doc): void {
  try {
    localStorage.setItem(AUTOSAVE_KEY, serializeDoc(doc));
  } catch {
    /* quota exceeded — skip */
  }
}

export function loadAutosave(): Doc | null {
  const raw = localStorage.getItem(AUTOSAVE_KEY);
  if (!raw) return null;
  try {
    return parseDoc(raw);
  } catch {
    return null;
  }
}

// ---- custom object library --------------------------------------------------

export function listCustomItems(): CustomItemDef[] {
  try {
    const raw = localStorage.getItem(CUSTOM_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function saveCustomItem(def: CustomItemDef): void {
  const list = listCustomItems().filter((d) => d.id !== def.id);
  list.push(def);
  localStorage.setItem(CUSTOM_KEY, JSON.stringify(list));
}

export function deleteCustomItem(id: string): void {
  localStorage.setItem(CUSTOM_KEY, JSON.stringify(listCustomItems().filter((d) => d.id !== id)));
}

// ---- export -----------------------------------------------------------------

function exportBounds(doc: Doc): BBox {
  const b = docBBox(doc);
  return b ? bboxPad(b, 50) : { minX: 0, minY: 0, maxX: 1000, maxY: 800 };
}

export function buildExportSvg(doc: Doc, settings: Settings, forPrint = false): SVGSVGElement {
  const b = exportBounds(doc);
  const w = b.maxX - b.minX;
  const h = b.maxY - b.minY;
  const palette = forPrint ? PRINT_PALETTE : LIGHT_PALETTE;
  const svg = el('svg', {
    xmlns: SVG_NS,
    viewBox: `${b.minX} ${b.minY} ${w} ${h}`,
    width: w,
    height: h,
  });
  svg.appendChild(
    el('rect', { x: b.minX, y: b.minY, width: w, height: h, fill: palette.paper, stroke: 'none' }),
  );
  svg.appendChild(buildScene(doc, { palette, unit: settings.unit, interactive: false }));
  return svg;
}

export function exportSVG(doc: Doc, settings: Settings): void {
  const svg = buildExportSvg(doc, settings);
  const xml = new XMLSerializer().serializeToString(svg);
  downloadFile(`${safeName(doc.name)}.svg`, 'image/svg+xml', xml);
}

export async function exportPNG(doc: Doc, settings: Settings, pxPerCm: number): Promise<void> {
  const b = exportBounds(doc);
  const svg = buildExportSvg(doc, settings);
  const xml = new XMLSerializer().serializeToString(svg);
  const img = new Image();
  const url = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(xml);
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error('SVG rasterization failed'));
    img.src = url;
  });
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round((b.maxX - b.minX) * pxPerCm));
  canvas.height = Math.max(1, Math.round((b.maxY - b.minY) * pxPerCm));
  const cx = canvas.getContext('2d')!;
  cx.drawImage(img, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/png'));
  if (blob) downloadFile(`${safeName(doc.name)}.png`, 'image/png', blob);
}

/**
 * Print at architectural scale: world cm × 10 = real mm; divided by the scale
 * denominator gives paper mm (e.g. 1:50 → 1 m of plan prints as 20 mm).
 */
export function printDoc(doc: Doc, settings: Settings, scaleDenom: number): void {
  const host = document.getElementById('print-host');
  if (!host) return;
  const b = exportBounds(doc);
  const svg = buildExportSvg(doc, settings, true);
  const wMM = ((b.maxX - b.minX) * 10) / scaleDenom;
  const hMM = ((b.maxY - b.minY) * 10) / scaleDenom;
  svg.setAttribute('width', `${wMM}mm`);
  svg.setAttribute('height', `${hMM}mm`);
  host.innerHTML = '';
  const caption = document.createElement('div');
  caption.className = 'print-caption';
  caption.textContent = `${doc.name} — scale 1:${scaleDenom}`;
  host.appendChild(caption);
  host.appendChild(svg);
  const cleanup = () => {
    host.innerHTML = '';
    window.removeEventListener('afterprint', cleanup);
  };
  window.addEventListener('afterprint', cleanup);
  window.print();
}

function safeName(s: string): string {
  return s.replace(/[^\w\-. ]+/g, '').trim() || 'floorplan';
}
