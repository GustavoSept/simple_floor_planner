// World units are centimeters. Lengths shown to the user follow Settings.unit.

export interface Vec {
  x: number;
  y: number;
}

/** Path vertex; `r` is an optional corner-rounding radius in cm (Illustrator-style). */
export interface Vertex extends Vec {
  r?: number;
}

export type LayerId =
  | 'structure'
  | 'furniture'
  | 'dimensions'
  | 'annotations'
  | 'electrical'
  | 'plumbing';

export const LAYER_ORDER: LayerId[] = [
  'structure',
  'furniture',
  'plumbing',
  'electrical',
  'dimensions',
  'annotations',
];

export const LAYER_NAMES: Record<LayerId, string> = {
  structure: 'Structure',
  furniture: 'Furniture',
  dimensions: 'Dimensions',
  annotations: 'Annotations',
  electrical: 'Electrical',
  plumbing: 'Plumbing',
};

export interface LayerState {
  visible: boolean;
  locked: boolean;
}

/**
 * Wall geometry reference. The drawn polyline is either a wall *face*
 * (align 'edge': thickness extends to one side, chosen by `side`) or the
 * centerline (align 'center'). Face-aligned walls let you draw/type the
 * inner or outer length directly, which is what you actually care about.
 */
export interface WallProps {
  thickness: number; // cm
  align: 'edge' | 'center';
  side: 1 | -1; // which side of the travel direction the thickness extends (align 'edge')
}

export interface EntityBase {
  id: string;
  layer: LayerId;
}

export interface PathEnt extends EntityBase {
  kind: 'path';
  vertices: Vertex[];
  closed: boolean;
  wall?: WallProps;
}

export interface ItemEnt extends EntityBase {
  kind: 'item';
  item: string; // symbol key, or 'custom:<defId>'
  x: number; // center, cm
  y: number;
  w: number; // cm
  h: number; // cm
  rotation: number; // degrees, clockwise on screen
  flip: boolean; // mirror along local x before rotation
}

export interface OpeningEnt extends EntityBase {
  kind: 'opening';
  opening: 'door' | 'window';
  wallId: string;
  seg: number; // wall segment index: vertices[seg] -> vertices[seg+1]
  t: number; // cm from segment start to opening center, measured on the centerline
  width: number; // cm
  hinge: 1 | -1; // door: hinge at segment-start end (1) or far end (-1)
  swing: 1 | -1; // door: which side of the wall it swings toward
}

export interface DimEnt extends EntityBase {
  kind: 'dim';
  a: Vec;
  b: Vec;
  offset: number; // signed perpendicular offset of the dimension line, cm
}

export interface TextEnt extends EntityBase {
  kind: 'text';
  x: number;
  y: number;
  text: string;
  size: number; // cm
}

export interface AreaLabelEnt extends EntityBase {
  kind: 'arealabel';
  pathId: string; // closed path whose area is displayed (recomputed live)
  name: string;
  x: number;
  y: number;
}

export type Entity = PathEnt | ItemEnt | OpeningEnt | DimEnt | TextEnt | AreaLabelEnt;

/** Reusable user-defined object ("save selection as object"). */
export interface CustomItemDef {
  id: string;
  name: string;
  w: number; // natural size, cm
  h: number;
  paths: { vertices: Vertex[]; closed: boolean }[]; // coords relative to center
}

export interface Doc {
  app: 'simple-floor-planner';
  version: 1;
  name: string;
  entities: Entity[];
  layers: Record<LayerId, LayerState>;
  customItems: Record<string, CustomItemDef>;
}

export function emptyDoc(name = 'Untitled plan'): Doc {
  const layers = {} as Record<LayerId, LayerState>;
  for (const l of LAYER_ORDER) layers[l] = { visible: true, locked: false };
  return { app: 'simple-floor-planner', version: 1, name, entities: [], layers, customItems: {} };
}

let idCounter = 0;
export function newId(): string {
  idCounter = (idCounter + 1) % 1296;
  return Date.now().toString(36) + idCounter.toString(36).padStart(2, '0');
}

export interface Settings {
  unit: 'm' | 'cm';
  gridSize: number; // cm
  showGrid: boolean;
  snapGrid: boolean;
  snapObjects: boolean;
  snapAngle: boolean;
  theme: 'light' | 'dark';
}

export const DEFAULT_SETTINGS: Settings = {
  unit: 'm',
  gridSize: 10,
  showGrid: true,
  snapGrid: true,
  snapObjects: true,
  snapAngle: true,
  theme: 'light',
};
