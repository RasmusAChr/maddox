# 0004 — Keyboard model: nothing should need the mouse

**Status:** accepted, 2026-10-22. The owner's goal: "minimize mouse touch".

## Principles

1. Every feature has a key. Every dialog or panel works fully from the
   keyboard: on open, focus goes to the obvious place; ↑/↓ select; Enter
   acts; Esc returns to the notebook.
2. Focus is never lost. A click on empty space never moves focus to
   `<body>` (the mousedown handler in `main.ts`). A click on empty
   notebook space puts the caret in the entry it hit, or in the last entry.
3. Deleting never leaves broken structure. Matrix cells always show a box.
   Bracket edges delete a whole `f(…)` call, not one bracket.
4. Global shortcuts are handled in a capture-phase `keydown` on `window`
   (`main.ts`). Entry shortcuts are handled in a capture-phase listener on
   the math-field host (`Notebook.onKeyDown`). Both run before MathLive's
   own handler, and MathLive bindings that conflict are removed in
   `Notebook.configure`.

## Key map

| Keys | Where | Action |
|---|---|---|
| Enter | cell | Evaluate every maths line, go to the next cell |
| Shift+Enter | cell | New line in the same cell |
| `#` at the start of a line | cell | The line is text |
| Ctrl+Enter | cell | New cell below |
| Alt+↓ | cell with a graph | Into its graph: ←/→ trace, ↑/↓ curve, Tab/Shift+Tab next/previous zero, max/min or intersection, +/− zoom, Ctrl+arrows pan, 0 reset, S sliders (←/→ change, ↑/↓ move, Esc back), Esc back |
| Alt+← / Alt+→ | graph-panel row `a = 3` | Nudge its slider (Shift ×10) |
| Alt+↓ | graph-panel row with sliders | To its sliders: ←/→ change, ↑/↓ move, Esc back to the row |
| Ctrl+G | anywhere | Graph panel open / close |
| F6 | panel open | Keyboard between notebook and panel |
| Ctrl+Shift+G | cell | Add the caret's line to the open graph tab |
| Ctrl+Enter / Ctrl+Shift+Backspace | graph panel | New tab / close tab |
| Ctrl+PageUp / PageDown, F2 | graph panel | Switch tab, rename it |
| Ctrl+U | cell | Type a unit (upright): / stays inline, * is ·, Space / Esc / Ctrl+U ends it |
| Alt+Enter | cell | Show this cell's answers as decimals (exact ones when the setting is "Decimals only"), or follow the setting again. Saved with the cell, marked ≈ (or =) |
| Ctrl+Shift+Enter | anywhere | Run all (resets the engine first) |
| ↑ / ↓ at the first or last line | cell | Previous / next cell |
| Ctrl+← / Ctrl+→ | cell | Jump by word: a run of letters or digits, an operator, a function name, or a whole structure such as `(…)`, a fraction or a matrix. At a group's edge, leave the group |
| Shift+Ctrl+← / → | cell | Select by the same jumps |
| Backspace in an empty cell | cell | Delete the cell |
| Ctrl+Shift+Backspace | cell | Delete the cell |
| Esc | while computing | Cancel (restarts the engine, clearing variables) |
| Ctrl+M | anywhere | Matrix size dialog (Tab between fields, Enter inserts) |
| Alt+↓/↑, Alt+→/← | in a matrix | Add a row below/above, a column right/left |
| Alt+Shift+↓/→ | in a matrix | Delete the current row / column |
| Tab | cell | Next empty box |
| Backspace / Delete at a bracket edge | cell | Empty brackets: delete the call. Otherwise: select the call, press again to delete |
| Ctrl+Backspace / Ctrl+Delete at a bracket edge | cell | Delete the whole call |
| Ctrl+P (or Ctrl+K) | anywhere | Search templates and app actions |
| Ctrl+B | anywhere | Toggle the template sidebar. Opening focuses its search field; closing returns to the cell |
| ↑ / ↓, Enter, Esc | sidebar search field | Move the selection; insert, or toggle "More"; back to the cell |
| Ctrl+N / Ctrl+O / Ctrl+S / Ctrl+Shift+S | anywhere | New / Open / Save / Save as |
| Ctrl+Shift+O | anywhere | Open a recent notebook (the search, narrowed to recent files) |
| Enter / D / Esc | "Save changes?" dialog | Save / don't save / cancel. Shown before New, Open, opening a recent or launch file, and closing the window, whenever there are unsaved changes |
| Ctrl+Shift+A (or the DEG/RAD chip) | anywhere | Switch degrees / radians for this notebook, then re-run everything |
| Ctrl+, (or the ⚙ button) | anywhere | Settings |
| ↑ / ↓, ← / →, Enter, Esc | settings dialog | Choose a setting; change it (applies at once); press a button (Clear recent files); close, back to the cell |
| Ctrl++ (or Ctrl+=) / Ctrl+− / Ctrl+0 | anywhere | Zoom in / out / reset (remembered; matched by character, so `+` works on Danish and US layouts alike) |
| F1 (or Ctrl+/) | anywhere | Shortcut list |

Clicking a result pastes it into the cell being edited.

## Removed MathLive defaults

| MathLive key | Its action | Why removed |
|---|---|---|
| Ctrl/Alt+Enter, Alt+Tab | add a matrix row / column | turns a plain expression into a matrix by surprise |
| Esc | raw-LaTeX mode | Esc means cancel here (typing `\` still opens LaTeX mode) |
