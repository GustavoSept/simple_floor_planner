import { describe, it, expect } from 'vitest';
import { openingGeom, setWallVertices } from './entity';
import { serializeDoc, parseDoc } from './io';
import { emptyDoc } from './types';
import type { Doc, OpeningEnt, PathEnt, Vertex } from './types';

// A 5m × 4m closed room. Segments (centerline order):
//   0: top    (0,0)->(500,0)
//   1: right  (500,0)->(500,400)
//   2: bottom (500,400)->(0,400)
//   3: left   (0,400)->(0,0)
const WALL: PathEnt = {
  id: 'W', kind: 'path', layer: 'structure', closed: true,
  vertices: [
    { x: 0, y: 0 },
    { x: 500, y: 0 },
    { x: 500, y: 400 },
    { x: 0, y: 400 },
  ],
  wall: { thickness: 15, align: 'edge', side: -1 },
};

const DOOR: OpeningEnt = {
  id: 'D', kind: 'opening', layer: 'structure', opening: 'door',
  wallId: 'W', seg: 2, t: 110, width: 90, hinge: 1, swing: 1,
};
const WINDOW: OpeningEnt = {
  id: 'N', kind: 'opening', layer: 'structure', opening: 'window',
  wallId: 'W', seg: 0, t: 250, width: 160, hinge: 1, swing: 1,
};

function docOf(...entities: Doc['entities']): Doc {
  const doc = emptyDoc('t');
  doc.entities.push(...entities);
  return doc;
}

/** World center of every opening, keyed by id (rounded to avoid fp noise). */
function centers(doc: Doc): Record<string, { x: number; y: number }> {
  const out: Record<string, { x: number; y: number }> = {};
  for (const e of doc.entities) {
    if (e.kind !== 'opening') continue;
    const g = openingGeom(doc, e);
    if (g) out[e.id] = { x: Math.round(g.c.x * 100) / 100, y: Math.round(g.c.y * 100) / 100 };
  }
  return out;
}

function withVertexAt(doc: Doc, wallId: string, index: number, v: Vertex): Doc {
  const wall = doc.entities.find((e) => e.id === wallId) as PathEnt;
  const vertices = [...wall.vertices];
  vertices.splice(index, 0, v);
  return { ...doc, entities: setWallVertices(doc.entities, wallId, vertices) };
}

function withoutVertex(doc: Doc, wallId: string, index: number): Doc {
  const wall = doc.entities.find((e) => e.id === wallId) as PathEnt;
  const vertices = wall.vertices.filter((_, i) => i !== index);
  return { ...doc, entities: setWallVertices(doc.entities, wallId, vertices) };
}

describe('opening anchors survive wall vertex edits (regression: doors/windows moved on load)', () => {
  it('the raw splice this fix replaces DID corrupt placement', () => {
    // Guard the guard: prove the naive edit (no re-anchor) moves the door, so
    // this suite would actually fail if the fix regressed.
    const doc = docOf(WALL, DOOR);
    const before = centers(doc);
    const naive: PathEnt = {
      ...WALL,
      vertices: [WALL.vertices[0], WALL.vertices[1], { x: 500, y: 200 }, WALL.vertices[2], WALL.vertices[3]],
    };
    const broken = { ...doc, entities: doc.entities.map((e) => (e.id === 'W' ? naive : e)) };
    expect(centers(broken)).not.toEqual(before); // door now resolves to a different segment
  });

  it('inserting a vertex on another segment leaves every opening exactly in place', () => {
    const doc = docOf(WALL, DOOR, WINDOW);
    const before = centers(doc);
    // split the right edge (segment 1) — no opening lives there
    const after = withVertexAt(doc, 'W', 2, { x: 500, y: 200 });
    expect(centers(after)).toEqual(before);
  });

  it('inserting a vertex on the same segment (opening still fits a half) keeps it in place', () => {
    const narrow: OpeningEnt = { ...WINDOW, t: 100, width: 60 }; // near the start of segment 0
    const doc = docOf(WALL, narrow);
    const before = centers(doc);
    const after = withVertexAt(doc, 'W', 1, { x: 350, y: 0 }); // split segment 0 past the window
    expect(centers(after)).toEqual(before);
  });

  it('deleting a vertex leaves openings on later segments in place', () => {
    const wall: PathEnt = {
      ...WALL, closed: false,
      vertices: [
        { x: 0, y: 0 }, { x: 200, y: 0 }, { x: 200, y: 200 },
        { x: 500, y: 200 }, { x: 500, y: 500 },
      ],
    };
    const op: OpeningEnt = { ...DOOR, seg: 3, t: 150 }; // on the final segment
    const doc = docOf(wall, op);
    const before = centers(doc);
    const after = withoutVertex(doc, 'W', 1); // remove an early vertex → indices shift
    expect(centers(after)).toEqual(before);
  });

  it('placement survives save + load after editing the wall', () => {
    const doc = docOf(WALL, DOOR, WINDOW);
    const edited = withVertexAt(doc, 'W', 2, { x: 500, y: 200 });
    const before = centers(edited);
    const loaded = parseDoc(serializeDoc(edited));
    expect(centers(loaded)).toEqual(before);
  });
});

describe('doc round-trip preserves opening placement', () => {
  it('opening geometry is identical after save + load', () => {
    const doc = docOf(WALL, DOOR, WINDOW);
    const loaded = parseDoc(serializeDoc(doc));
    expect(centers(loaded)).toEqual(centers(doc));
  });
});
