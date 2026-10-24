# 0008 — Graphs: plot() in a cell, and a graph panel with tabs

**Status:** accepted, 2026-10-24. All four releases are built: inline
`plot()`, the panel, points worth knowing, and sliders.

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

## Release 2 (built)

- Ctrl+G opens or closes the panel: the window splits 50/50 and the
  keyboard goes to the open tab's list. F6 moves between notebook and panel.
- Tabs: "Graph 1" to start; **+** or Ctrl+Enter (in the panel) adds one,
  × or Ctrl+Shift+Backspace closes one (a second press confirms when it has
  items; browsers keep Ctrl+T/W). Ctrl+PageUp/PageDown switch, F2 or a
  double-click renames.
- The list sits above the graph, one maths field per row. Enter adds a row,
  Backspace in an empty one removes it, ↑/↓ move, ↓ from the last row goes
  into the graph, Esc back to the notebook (Esc in the graph: back to the
  list). A row that can't be drawn shows why; the others still draw. A row
  with no x in it (`f(5)`, `2+3`) is a value: it shows `= 23` after a
  dotted leader, as a cell would (answer mode applies), and isn't drawn.
  A function at a number (`f(0)`) also marks the point (0, f(0)) with a
  dot in the row's colour (its chip is a dot). In an inline `plot(…)` the
  same holds: f(a) is a dot, other values are left out of the drawing.
- **Definitions in a tab are local** (the owner's choice): `g(x) = 2x + 3`
  defines g for that tab only. It is drawn, and other rows of the tab can
  use it (`g(0) = 3`, with its dot). `a = 5` defines a value; `y = …` just
  draws. A tab's name hides a notebook name of the same spelling there.
  `:=` in a row is an error ("Use = to define g in this graph. := defines it
  for the whole notebook, so do that in a cell."), and the notebook never
  sees a tab's names: in Giac they are `maddox_local_g`, defined before the
  tab is drawn and purged before the next draw (`readPanelRow`, `localise`).
  Before this, a row like `g(x):=…` defined g globally as a hidden side
  effect.
- Ctrl+Shift+G in a cell adds the caret's line: `f(x):=…` adds f, `D:=…`
  adds D, `plot(…)` its items, anything else the expression
  (`plotItemsFromLine`).
- The panel re-plots after every cell evaluation (so redefining f, and the
  recalculation after it, shows at once).
- Saved in the file as `"graphs": {open, active, tabs: [{name, items, view}]}`;
  files without it open with the panel closed.

## Release 3 (built)

- While a curve is traced, its zeros, y-intercept, maxima, minima and
  intersections with the other curves in view show as grey dots (the
  owner's choice: for the traced curve only, like Desmos). Tab / Shift+Tab
  jump the trace between them; the readout names the point exactly with ≈:
  "Zero  x = √3 ≈ 1.73205, y = 0", "Intersection with g …".
- `GiacSession.features` solves in the view only
  (`solve([eq, t>=a, t<=b], t)`, so sin x = 0 gives −3π…3π), keeps short
  exact forms (`isShortExact`), and falls back to `fsolve` in the window for
  the rest (eˣ = 3x). Max/min from f′ = 0 and the sign of f″ (or of the
  neighbours when f″ = 0). Recomputed in the background after zoom or pan.

## Release 4 (built)

- Inline: names without a value (`plot(a·x² + b)`) get sliders under the
  graph, starting at 1, saved with the cell (`"sliders": {line: {a: 1}}`).
  They are the graph's own: in Giac `maddox_s<n>_a`, left as symbols when
  the curve is built (`plot(giac, params)`) and set before sampling, so
  moving a slider redraws without re-plotting. A notebook `a := 2` takes
  priority (then there is no slider). Keys: S in the graph goes to the
  first slider; ←/→ change it (Shift ×10), ↑/↓ move between sliders (↑ from
  the first back to the graph), Esc back to the graph.
- Panel: a row `a = 3` (a plain number) gets a slider under it; Alt+←/→ in
  the row nudge it and the row's text follows (so it saves as text). A row
  that uses names without a value says so ("Enter adds sliders"); Enter, or
  leaving the row, adds `a = 1` rows (the owner's choice: add, don't ask).
- Range −10…10 in steps of 0.1, widened by powers of ten for bigger values
  (`sliderRange`, `nudge`).
- **The axis is never guessed** (the owner: "fair not to accommodate every
  possible thing"). One rule: the horizontal axis is x for an expression and
  a function's own parameter for a function (`plot(hh)` with `hh(b₀) := …`
  runs over b₀). Every other name without a value is a parameter and gets a
  slider, also inside a function's definition (the slider names are
  substituted in, `plot(giac, sliders)`). What falls outside says so: no x
  ("Use x, or define a function, e.g. f(t) := t²"), and five or more names
  without a value ("Too many names without a value …: define some in a
  cell"; usually a typo). Implicit curves (x² + y² = 1), parametric and
  polar curves are out of scope. Before this, a function whose definition
  used unknown names gave a silently empty graph.
- **In a definition, the parameter is known** (the owner's choice, applied
  where the function is defined, so cells and graphs agree): in
  `f(p) := …`, an undefined name of letters followed by p is those letters
  times p. `hh(b₀) := ab₀ + b` is b₀ → a·b₀ + b, and `f(x) := ax² + b` is
  x → a·x² + b, so `plot(hh)` gets sliders a and b. Defined names (XTy) stay
  whole; outside a definition letters typed together remain one name
  (`GiacSession.splitByParameter`, also used for graph-tab definitions).
- **In graphs, `ax` is a·x** (the owner's choice, as in Desmos and
  GeoGebra): in `plot(…)` and panel rows, an undefined name of letters that
  contains x is read letter by letter, so `plot(ax² + b)` gets sliders a and
  b. Defined names (XT, fp), calls and a tab's own names stay as they are,
  and cells keep the rule that letters typed together are one name
  (`GiacSession.splitUnknown`, run before slider names are localised).

## Consequences

- Engine: `GiacSession.plot` / `sample`, worker messages `plot` and
  `sample`, `Engine.request(…, background)`.
- UI: `notebook/graph.ts` (drawing, keys, mouse; `fill`, `legend`,
  `colours` options for the panel) and `graph-math.ts` (window, ticks,
  breaks; unit-tested). `Notebook.renderGraphs` keeps one graph per plot
  line. `ui/graph-panel.ts` is the panel; `notebook/plot-items.ts` what
  Ctrl+Shift+G adds.
