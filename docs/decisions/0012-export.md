# 0012 — Export: print / PDF, and copying a result

**Status:** accepted, 2026-10-26. The owner chose print/PDF plus copying
a result, laid out like the screen, plain text by default, Ctrl+Shift+P.

## Problem

The roadmap item was "Export: PDF or print, and copy a result as LaTeX or
plain text." There was no way to print (printing the page would include
the toolbar, sidebar and status bar), and no way to put a result on the
clipboard: a click on a result pastes it into the cell being edited.

## Options considered

- **Print / save as PDF** through the system print dialog (chosen). No
  PDF library: Windows has "Microsoft Print to PDF", Linux "Print to File".
- **Copy a result** (chosen), plain text by default, LaTeX from Ctrl+P.
- **Export as a document** (`.md` / `.tex`, graphs as SVG). Left out until
  someone needs it; PDF covers handing work in.
- Layout on paper: like the screen (chosen), or each result below its
  input (more pages).

## Decision

1. **Ctrl+Shift+P** (and Ctrl+P "Print / Save as PDF") opens the print
   dialog. Ctrl+P itself stays search.
2. **On paper:** only the notebook, laid out like the screen (results on
   the right with leaders, graphs below their cell), in the light theme,
   the notebook's name and the date on top, empty cells left out, a cell
   never split across pages. Screen-only hints (the graph's key line,
   "graph below · Alt+↓") are left out. A4 with 15 mm margins.
3. **Ctrl+Shift+C** copies the result of the caret's line as it is shown,
   exact then decimal: `1/2 ≈ 0.5`, `x=sqrt(2) or x=-sqrt(2)`. The text is
   MathLive's AsciiMath, tidied (`plain-text.ts`). Ctrl+P "Copy result as
   LaTeX" gives `\frac{1}{2} \approx 0.5`. A graph or an error is not
   copied; the status bar says so.
