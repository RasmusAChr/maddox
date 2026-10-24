# 0008 — Graphs: plot() in a cell, and a graph panel with tabs

**Status:** accepted, 2026-10-24. Release 1 (inline `plot()`) is built;
releases 2–4 follow, each proposed in detail before it is built.

## Problem

Graphing is the largest gap against the TI-Nspire. The owner wants it for
quick looks at a cell's functions, for a coordinate system that grows over
a notebook, and for machine-learning work (data points with a fitted line).
"One kind of cell" (decision 0003) rules out a separate graph cell.

## Decision

Both, built on one graph component (same drawing, keys and maths):

1. **Inline:** `plot(f, g, D)` in a cell. The graph is that line's result,
   drawn below the cell, and saved with the notebook.
2. **Panel:** Ctrl+G splits the window 50/50, notebook left, coordinate
   system right. It starts with one tab; **+** adds more. Each tab has its
   own list of what it shows (f, g, D, x² − 2), added there or from a cell
   line with Ctrl+Shift+G. Saved in the file.
3. **Phase 1 content** (all four, over the releases): functions of x,
   points and scatter, exact zeros/extrema/intersections (Giac, with ≈),
   sliders for names without a value.
4. **Delivery:** four releases, each usable and committed on its own:
   1. the graph component and inline `plot()`: functions, points, zoom,
      pan, trace;
   2. the panel with tabs and their lists;
   3. exact zeros, extrema and intersections;
   4. sliders.

## Release 1 (built)

- `plot(…)` takes defined functions, expressions in x, points and lists of
  points, mixed. A name with no value is an error until sliders exist.
- Window: x from −10 to 10 (−360° to 360° for trig in degree mode), y
  fitted to the middle 96 % of the values plus the points. A view zoomed or
  panned to is saved with the cell (`"views"` by line); 0 resets it.
- Keys: Alt+↓ from the cell into its graph; ←/→ trace (Shift: ×10), ↑/↓
  switch curve, +/− zoom, Ctrl+arrows pan, 0 reset, Esc back. Mouse: wheel
  zoom, drag pan, hover coordinates.
- SVG, one colour per item (`--plot-1…6`). Curves break where the function
  has no real value and at asymptotes.
- Sampling: `GiacSession.sample` (one Giac call per curve per view, float x),
  in the background: it shows no "busy" and Esc never cancels it.

## Consequences

- Engine: `GiacSession.plot` / `sample`, worker messages `plot` and
  `sample`, `Engine.request(…, background)`.
- UI: `notebook/graph.ts` (drawing, keys, mouse) and `graph-math.ts`
  (window, ticks, breaks; unit-tested). `Notebook.renderGraphs` keeps one
  graph per plot line.
