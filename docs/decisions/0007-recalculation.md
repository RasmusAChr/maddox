# 0007 — Changing a definition recalculates the cells that use it

**Status:** accepted, 2026-10-24. The owner chose "recalculate" over
"mark stale", and the recommendation on the three questions below.

## Problem

Change `r := 3` to `r := 4` and press Enter: only that cell ran. The cells
below that use r kept their old answers, with nothing showing they were
wrong, until Run all.

## Options considered

- **Mark stale:** grey out the cells that use r until they are re-run.
  Rejected by the owner in favour of recalculating.
- **Re-run every cell below:** simple, but an unrelated slow cell runs
  again on every edit.
- **Run all on every definition change:** handles everything, but runs the
  whole notebook (cells above too) and resets the engine each time.
- **Re-run only the cells that depend on it** (chosen).

## Decision

1. **Enter on a cell that defines something** (`r := 4`, `f(x) := …`)
   re-runs, top to bottom, the cells *below* it that use a changed name,
   then the cells that use what those define, and so on. Cells above, and
   cells that don't use it, are left alone. The notebook reads top to
   bottom, like paper.
2. **A definition that goes away** (the cell is deleted, or `r := 4` is
   changed to `s := 4`) is cleared (`purge`), unless a cell above still
   defines it, which then runs again. The cells that used it update and
   show r as a symbol.
3. **Results that changed flash** softly for about a second (none with
   reduced motion). Esc cancels a recalculation like any evaluation.

## Consequences

- `app/src/engine/dependencies.ts` (`lineNames`) reads the Giac text of a
  line: what it assigns (`r`, `f`) and every other name it uses. A
  function's parameters are its own. Over-counting only costs a re-run.
- `Notebook.recalculateFrom` walks the cells below. A cell that redefines a
  changed name runs again to put its own value back, and then that name is
  no longer "changed" below it. A cell that uses `ans` runs if the cell
  before it ran. `restart`, `purge` and `assume` in the edited cell re-run
  everything below; below, such cells always re-run.
- Cells are analysed from their current input, as Run all would run them.
  Cells never run (`evaluatedLatex === null`) are skipped.
- A newer recalculation, Run all, or a cancel stops an older one
  (`Notebook.recalculation` counter).
