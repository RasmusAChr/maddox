# 0011 — Names never convert by themselves; Tab takes a grey suggestion

**Status:** accepted, 2026-10-26. The owner chose ghost text with Tab,
"only convert on Tab", and suggestions for functions, notebook names and
Greek letters.

## Problem

The roadmap item was "Autocomplete command names" (`sol…` becomes
`solve`). The owner did not want automatic completion: typing
`solution1 := …` must not turn into solve halfway. Checking the app showed
the same problem already existed for whole names, because MathLive's
inline shortcuts converted a name the moment its letters were typed:

| Typed | Became |
|---|---|
| `determinant` | `det` · `erminant` |
| `factorial` | `factor` · `ial` |
| `pick` | `π` · `ck` |
| `limit` | a lim template with "it" inside |

## Options considered

- **Grey ghost text, Tab accepts** (chosen). One suggestion, after the caret.
- A list of up to five matches below the caret. More to see, but ↑/↓ move
  between cells and Enter evaluates, so choosing would be awkward.
- A hint in the status bar only. Easy to miss.
- For conversion: convert on `(` or Tab, or keep the instant conversion.
  The owner chose Tab only.

## Decision

1. **After two letters typed together**, the best name that starts with
   them shows in grey after the caret. Order: names the notebook defines
   in evaluated cells above (nearest first; functions with their
   parameters, `area(r)`), then the catalog's functions in sidebar order
   (everyday before "More"), then Greek letters and the templates typed by
   name (`sqrt`, `int`, `lim`, `sum`, `prod`, `infinity`, `otherwise`).
   Case matters (`De` → Δ). A whole name of your own needs no suggestion.
2. **Tab takes it**, replacing the letters with the same template the
   sidebar inserts (`solve(□, x)`). One Ctrl+Z goes back to the letters.
   **Esc** hides it until the next letter. With no suggestion showing, Tab
   is "next empty box" as before.
3. **Names never convert by themselves.** Only notation does: `:=`, `<=`,
   `>=`, `!=`, `->`, `dx`/`dy`/`dt`, and `deg` after a number. A function
   typed as letters (`sin(30)`, `solve(…)`) still computes: a plain name
   followed by `(` is a call when Giac knows it as a function. It just
   reads as letters.
4. Graph-panel rows get the same suggestions, with every name the
   notebook defines.
5. No Trie: there are about a hundred names, and a scan takes far under a
   millisecond. The order of the suggestions is what matters.
