# 0003 — Cell model: one kind of cell, multi-line, `#` text lines

**Status:** accepted, 2026-10-22, as decided by the owner.

## Decision

- **One cell type.** A notebook is a list of cells, and each cell is one
  MathLive field.
- **Lines.** Shift+Enter adds a line inside the same cell
  (`breakLine` in `mathlive-internals.ts`). If the caret is inside a matrix
  or fraction, the line is ended first, so the matrix does not grow
  instead.
- **Text lines.** A line starting with `#` is text: typing `#` at the start
  of a line switches it to MathLive text mode, and the line is shown but
  never evaluated. It is stored as `\text{\# …}` (`isTextLine` in
  `app/src/notebook/lines.ts`).
- **Evaluation.** Enter evaluates every maths line of the cell from top to
  bottom, then moves to the next cell (creating one at the end, like a
  calculator).
- **Results.** Each line's result is shown on the right, level with its
  line (`layoutResults` in `notebook.ts` measures the lines with
  `lineBoxes`). A result taller than its line pushes the following results
  down rather than overlapping them.
- **Saving.** A notebook is saved as a `.maddox` file: JSON
  `{format:"maddox-notebook", version:1, entries:[{latex}]}`. A multi-line
  cell is one entry, holding `\displaylines{…}` or a bare `a\\ b` (see
  gotchas). Results are not saved; they are recomputed on open.

## Rejected (don't rebuild these)

- **Separate text blocks between calculations.** These were built, then
  rejected by the owner: "There should not be different types of cells."
  `toCells` in `app/src/files.ts` still converts any `{text}` entries saved
  during that brief period into `#` lines.
- **Text lines marked with `"`.** The owner chose `#`.
- **Automatic text detection** (treating anything that isn't valid maths as
  text). A typo in maths would silently become text instead of an error.
- **Evaluating only the last line.** The owner chose every maths line, each
  with its own result.
