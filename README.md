# Simple Floor Planner

A local-only floor plan editor. Vanilla TypeScript + RxJS + SVG — no framework, no server, no internet needed.
100% written by AI, not representative of my work.

## Getting started

```sh
npm install        # once
npm run dev        # development server with hot reload
npm run build      # produces dist/index.html
```

The build is a **single self-contained HTML file** (`dist/index.html`). Open it straight from disk (`file://`) in any browser — everything is inlined, no network access required.

## Features

- **Draw**: walls (with real thickness), lines, rectangles, polygons. Type a number while drawing for an exact segment length.
- **Walls measure the face you care about**: the drawn line is a wall *face* (inner or outer — your choice, Tab flips the thick side) or the centerline. Dimension lines and the tape measure snap to wall face corners, so you always read inner/outer lengths, never centerline lengths.
- **Edit**: drag vertices, add one by dragging the small ○ at an edge midpoint (or double-click the edge), Del removes. Corner rounding Illustrator-style: select a vertex and drag the orange handle (or type an exact radius) — the three vertices stay, the middle one carries the radius.
- **Openings**: doors (swing arc, flip swing/hinge) and windows embedded in walls; drag them along or between walls.
- **Measure**: live lengths while drawing, tape measure, architect-style dimension lines, area labels (click inside a closed shape — walls report the inner face area).
- **Objects**: furniture / electrical / plumbing symbol library, all resizable via Properties; save your own drawn shapes as reusable objects.
- **Layers**: Structure, Furniture, Plumbing, Electrical, Dimensions, Annotations — show/hide and lock.
- **Everything else**: undo/redo, pan/zoom/fit, grid + object + angle snapping (hold Ctrl to bypass), multi-select, rotate, duplicate, dark mode.

## Saving

- **Files**: `File → Save file` downloads a `.floorplan.json` (plain JSON, versioned) and also updates the browser plan of the same name; `Open file…` loads it.
- **Browser**: `File → My plans…` keeps named plans in localStorage; the working copy is autosaved continuously and restored on reload.
- **Export**: SVG or PNG images; `Print to scale…` prints at true 1:50 / 1:100 etc.

Press `?` in the app (or the `?` button) for the full shortcut list.

## Code map

| Path | What |
| --- | --- |
| `src/types.ts` | Document/entity model (cm world units) |
| `src/geom.ts` | Vector math, polyline offsetting, corner-rounding arcs, areas |
| `src/store.ts` | RxJS document store with snapshot undo/redo |
| `src/entity.ts` | Entity-level geometry (bboxes, wall placement, transforms) |
| `src/snap.ts` | Grid / vertex / edge / angle snapping |
| `src/render.ts` | Document → SVG (used for canvas, export and print) |
| `src/symbols.ts` | Parametric plan symbols |
| `src/tools/` | Tool state machines (select, draw, openings, measure, place) |
| `src/ui.ts` | Toolbar, panels, dialogs |
| `src/io.ts` | File/localStorage persistence, SVG/PNG export, print |
| `src/main.ts` | Wiring, render loop, keyboard shortcuts |
