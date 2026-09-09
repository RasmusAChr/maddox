# 2D Math Input — Design Spec

**Date:** 2026-09-09
**Status:** Approved for planning
**Builds on:** `2026-09-09-math-notebook-design.md` (v1 notebook)

## Overview

Replace the code-style text editor in each cell with a 2D math field, so
input reads and behaves like math: typing `^` raises a filled-in box for
the exponent, fractions and roots render as you type, and templates
insert fillable placeholder fields — the TI-Nspire feel. Evaluation is
unchanged: the math field's LaTeX is converted to the engine's existing
text syntax, which SymPy evaluates exactly as before.

## Goals

- Cell input is a MathLive `<math-field>` (open source, MIT, vendored
  for offline use), not CodeMirror.
- Everything expressible today stays expressible: `x := 5`,
  `solve(2x = 4, x)`, `Matrix([[1, 2], [3, 4]])`, `clear(x)`, etc.
  Function names render upright (`solve`, not italic s·o·l·v·e).
- All current keyboard behaviour is preserved on the new editor:
  Enter = new cell below, Ctrl+Enter = run, Backspace on an empty cell
  = remove (never the last one), Up/Down = move between cells,
  Ctrl+Shift+Enter = Run All.
- Templates insert placeholder fields; Tab jumps to the next field.
- Notebook files carry both the LaTeX (for display) and the engine text
  (for evaluation). Files saved by v1 still open.

## Non-goals

- Multiline cells (decided separately: leave as is; a math field is
  single-line).
- Changing how results are rendered (KaTeX output stays).
- The MathLive virtual on-screen keyboard beyond its default toggle.
- A LaTeX-to-engine converter that handles arbitrary LaTeX. It handles
  what the math field can produce from the notations listed below;
  anything else is reported as an error, never silently mis-evaluated.

## Architecture

```
math-field (LaTeX)  --evaluate_cell(index, latex)-->  Api
                                                        |
                                    latex_input.to_engine_text(latex)
                                                        |
                                                  Engine.evaluate(text)
```

- **Frontend** owns the math fields, keymap, templates. It sends LaTeX
  to the backend; it never converts.
- **`mathnb/latex_input.py`** (new) converts LaTeX to engine text. Pure
  function, no SymPy dependency, fully unit-tested. Raises
  `UnsupportedLatex` with the offending fragment for anything outside
  its rule table.
- **`Api`** converts before evaluating and stores both forms on the
  cell. `set_cell_texts` receives LaTeX too.
- **`Engine`** is untouched.

## Conversion rules (`latex_input.to_engine_text`)

Applied to MathLive's LaTeX output. Whitespace and `\,`/`\;`/`\!`
spacing commands are dropped; `\left`/`\right` are dropped, keeping the
bracket.

| LaTeX | Engine text |
|---|---|
| `a^{b}`, `a^b` | `a^(b)` |
| `\frac{a}{b}` | `((a)/(b))` |
| `\sqrt{a}` | `sqrt(a)` |
| `\sqrt[n]{a}` | `((a)^(1/(n)))` |
| `\cdot`, `\times` | `*` |
| `\div` | `/` |
| `\pi`, `\infty` | `pi`, `oo` |
| `\exponentialE` (MathLive's e) | `E` |
| `\imaginaryI` | `I` |
| Greek `\alpha` … `\omega` | `alpha` … `omega` (SymPy auto-symbols) |
| `\lambda`, `\beta`, `\gamma`, `\zeta`, `\Lambda`, `\varepsilon`, `\vartheta`, `\varphi` | `lamda`, `beta_`, `gamma_`, `zeta_`, `Lambda_`, `varepsilon_`, `vartheta_`, `varphi_` |
| `x_{1}`, `x_1` | `x_1` |
| `\le`, `\ge`, `\ne` | `<=`, `>=`, `!=` |
| `\coloneq`, `:=` | `:=` |
| `\operatorname{f}`, `\mathrm{f}`, `\text{f}` | `f` |
| `\sin` … (standard function commands) | `sin` … |
| `\begin{pmatrix} a & b \\ c & d \end{pmatrix}` (also `bmatrix`, `matrix`) | `Matrix([[a, b], [c, d]])` |
| `\{`, `\}` | `{`, `}` |
| `\%` | `%` (left to the engine to reject) |
| `\log_{2}`, `\sin^{2}` (script on a function name) | error: use `log(x, 2)` / `(sin(x))^2` |
| `\frac{d}{dx}`, `\frac{dy}{dx}` (Leibniz derivative) | error: `Use diff(expr, x) for derivatives` |
| a bare `\|` (absolute-value bars) | error: `Use Abs(x) for absolute value` |
| `\ldots`, `\cdots` | error (unsupported) |
| any other `\command` | error: `Unsupported notation: \command` |

Plain characters (`+ - * / = ( ) [ ] , . digits letters`) pass through.
`2x` stays `2x` — the engine's implicit multiplication handles it.
Braces used only for grouping (`{2}`) become parentheses.

**Name separation.** Every *name* the converter emits — `pi`, `oo`, `E`, `I`,
`d`, the Greek symbols, function names (`sin`, `sqrt`, `Matrix`, and
`\operatorname{…}` bodies) — is separated from an adjacent alphanumeric
character with an explicit `*` on either side. The engine parses with SymPy's
`implicit_multiplication_application`, whose `split_symbols` step shreds any
unknown multi-letter token, so a glued name is not merely ugly but silently
wrong: `2\pi r` → `2pir` → `2·p·i·r`, `x\sqrt{y}` → `xsqrt(y)` → `q·r·s·t·x·y`.
The `*` is inserted only between two alphanumerics, so a call's parenthesis
still binds (`\sin(x)` → `sin(x)`, `clear(\alpha)` → `clear(alpha)`); nothing is
parenthesised.

- `2\pi r` → `2*pi*r`, `2\pi` → `2*pi`, `x\pi` → `x*pi`, `x\infty` → `x*oo`
- `\alpha\beta` → `alpha*beta_`, `\exponentialE^{\imaginaryI\pi}` → `E^(I*pi)`
- `x\sqrt{y}` → `x*sqrt(y)`, `x\sin(x)` → `x*sin(x)`, `\sin(x)` → `sin(x)`
- `\sin x` (a function name juxtaposed with a letter, which the engine has no
  meaning for) therefore becomes `sin*x` and fails loudly with a TypeError
  instead of silently evaluating to `i·n·s·x`.

**Greek renames.** `\lambda` cannot be spelled `lambda` (a Python keyword);
`beta`, `gamma` and `zeta` are SymPy *functions* and `Lambda` a SymPy class, so
they would render as `B`/`Γ`/`ζ`-the-function or raise a `TypeError`; and
`varepsilon`/`vartheta`/`varphi` are unknown multi-letter names that
`split_symbols` shreds. All are emitted with a trailing `_`, which SymPy parses
as a plain `Symbol` and `sympy.latex` still renders as the Greek letter
(`\beta_{}`).

Round-trip examples the tests must pin down:

- `x\coloneq5` → `x:=5`
- `\operatorname{solve}\left(2x=4,x\right)` → `solve(2x=4,x)`
- `5^{2}` → `5^(2)`
- `\frac{x^{2}}{2}+\sqrt{x}` → `((x^(2))/(2))+sqrt(x)`
- `\operatorname{Matrix}\left(\left[\left[1,2\right],\left[3,4\right]\right]\right)` → `Matrix([[1,2],[3,4]])`
- `\begin{pmatrix}1&2\\3&4\end{pmatrix}` → `Matrix([[1,2],[3,4]])`
- `\operatorname{clear}\left(x\right)` → `clear(x)`
- `2\pi r` → `2*pi*r`
- `\exponentialE^{\imaginaryI\pi}` → `E^(I*pi)` → `-1`

## Frontend

**Editor.** Each cell's input is a `<math-field>`. MathLive is loaded
from `frontend/vendor/mathlive/` (script + `fonts/`), with
`MathfieldElement.fontsDirectory` pointing there — no network needed.
Its default virtual-keyboard toggle is kept; sounds are disabled.

**Function names.** Every engine function the templates use (`solve`,
`simplify`, `expand`, `factor`, `diff`, `integrate`, `limit`, `Matrix`,
`det`, `N`, `clear`, `subs`, `inv`, `eigenvals`, …) is registered as a
MathLive inline shortcut so typing the name produces
`\operatorname{name}` — rendered upright, converted back to the bare
name. Typing `:=` produces `\coloneq`. `sqrt` is deliberately *not* in that
list: MathLive already ships a `sqrt` shortcut that builds the 2D radical
`\sqrt{#?}`, and overriding it with `\operatorname{sqrt}` would replace the
radical with flat upright text.

**Keymap** (replaces the CodeMirror keymap one-for-one):

| Key | Behaviour | Mechanism |
|---|---|---|
| Enter | new cell below, focus it | `beforeinput` with `inputType === 'insertLineBreak'` |
| Ctrl+Enter | run this cell | host `keydown`; MathLive's own `ctrl+[Return]`/`ctrl+[Enter]` → `addRowAfter` bindings are removed in `configureMathField`, or inside a matrix the run key would add a row before running |
| Ctrl+Shift+Enter | run all | existing document-level listener |
| Backspace on empty field | remove cell unless it is the only one | `keydown` when `mf.value === ''` |
| Up / Down | move to previous/next cell | `keydown`; only when MathLive's own `moveUp`/`moveDown` cannot move (e.g. not inside a fraction), so in-expression navigation still wins |
| Tab / Shift+Tab | next/previous placeholder if the field has any, else browser default | `keybindings` |

**Templates.** Snippets become LaTeX with `\placeholder{}` fields, e.g.
"Solve equation" → `\operatorname{solve}\left(\placeholder{}=0,x\right)`.
Insertion goes through `mf.insert(latex)` at the cursor; a text selection
is wrapped into the first placeholder as today. The sidebar keeps showing
each snippet's engine-text form as the hint.

**Cell state and sync.** `cellEditors` holds math-field elements.
`syncTexts` sends each field's LaTeX. `runCell` sends LaTeX. Everything
else (indices, insert/remove, focus movement, output rendering) is
unchanged.

## Backend and file format

`Api.evaluate_cell(index, latex)` and `Api.set_cell_texts(latexes)`
convert with `latex_input.to_engine_text`. An `UnsupportedLatex` error is
returned in the cell's `error` field like any other error; the engine is
not called.

Cell dict gains one key:

```json
{"latex": "x\\coloneq5", "input": "x:=5", "output_latex": "5", "error": null}
```

`input` remains the engine text (so `run_all` and the engine tests are
unaffected). Files from v1 have no `latex`; on load the frontend imports
`input` into the field with `mf.setValue(input, {format: 'ascii-math'})`
as a best-effort display, and the next save writes `latex`.

## Error handling

- Unsupported notation → cell error `Unsupported notation: \foo`, cell
  is not evaluated, namespace untouched.
- MathLive failing to load (missing vendor file) → visible error text in
  the cells area instead of a blank window (the v1 offline-asset lesson).
- Engine errors are unchanged and still render in the cell.

## Testing

- `tests/test_latex_input.py`: one test per rule in the table plus the
  round-trip examples, and the unsupported-notation error.
- `tests/test_latex_input_engine.py`: the same LaTeX run all the way through
  `Engine.evaluate`, asserting the *value*. Conversion tests alone cannot see
  the split-symbols class of bug, where plausible-looking engine text evaluates
  to something else. Covers every entry of the frontend's `TEMPLATES` table
  (read straight out of `notebook.js`, so the two cannot drift).
- `tests/test_api.py`: `evaluate_cell` with LaTeX stores both `latex`
  and `input`; unsupported LaTeX yields an error dict; a v1 cell without
  `latex` still loads and runs; `set_cell_texts` on unsupported LaTeX keeps the
  cell's existing engine text (a Save must never blank an imported v1 cell)
  while recording the error and dropping the stale output.
- Frontend: as before, no automated UI tests; verified with
  `evaluate_js` probes and DPI-aware screenshots — specifically that
  `5^{2}` shows a raised exponent, a template shows placeholder boxes,
  and each keymap row above behaves.
