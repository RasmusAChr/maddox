# Math Notebook — Design Spec

**Date:** 2026-09-09
**Status:** Approved for planning
**Author:** Rasmus (rasmus@supera.dk), designed with Claude

## Overview

A free, personal, cross-platform (Windows + Linux) notebook-style math
application, filling the gap between WordMat (Word-integrated CAS,
Windows/Word-only) and TI-Nspire/Maple (proprietary, not free). Combines
WordMat's "compute inline as you write" workflow with a TI-Nspire-like
unified feel, built entirely on free/open tooling (SymPy as the CAS engine).

This is a personal project — built for the author's own use, and to be
owned/built rather than just solved by an existing tool (wxMaxima was
considered and rejected specifically because the author wants to build
this themselves).

## Goals

- Notebook UI: sequential cells, each holding a math input and its
  computed output, persisted to a file you can reopen.
- Nspire/Maple/WordMat-style syntax: `a:=2`, `b:=4`, `x:=a+b` for
  assignment; bare `=` for equations (e.g. `solve(x^2 = 4, x)`).
- Core math capability: symbolic CAS (solve, simplify, expand, factor,
  diff, integrate, limits) and linear algebra (matrices, determinants,
  eigenvalues, systems of equations) — via SymPy.
- Runs identically on Windows and Linux from the same codebase.

## Non-goals (v1)

- Graphing, statistics, or unit-aware arithmetic (SymPy can do all of
  these later; just not in v1's scope).
- Live/spreadsheet-style recalculation — cells are re-run explicitly,
  top-to-bottom, notebook-style (like Jupyter), not auto-recalculated
  when an upstream variable changes.
- Auto-save or crash recovery — explicit save only.
- Packaging/installers — v1 runs from a Python entry point in a venv;
  PyInstaller packaging is a later nice-to-have.
- Multiple notebooks open at once / tabs.

## Architecture

Four components, single process, no network server:

1. **Compute core (Python + SymPy)** — a persistent namespace (plain
   Python dict) per open notebook, pre-populated with SymPy's CAS and
   linear-algebra surface (`solve`, `diff`, `integrate`, `limit`,
   `simplify`, `expand`, `factor`, `Matrix`, `eye`, `det`, `symbols`,
   `Eq`, ...). Each cell executes against this namespace, REPL-style,
   so variables defined in one cell are visible to later cells.

2. **Bridge (pywebview `js_api`)** — no HTTP server, no port. The
   frontend calls Python functions directly through pywebview's
   built-in JS↔Python bridge (`evaluate_cell(text)`,
   `save_notebook(path)`, `load_notebook(path)`, `new_notebook()`).
   Single process; nothing listens on the network.

3. **Frontend (HTML/CSS/JS)** — CodeMirror for cell input, KaTeX to
   render SymPy's LaTeX output, cells stacked vertically. No frontend
   framework needed at this scale.

4. **Notebook file (JSON on disk)** — see Persistence below.

## Input syntax & evaluation model

A pre-processing layer sits in front of SymPy's parser and classifies
each cell's text into one of three forms:

- **Assignment** — text contains `:=`. Split into `lhs := rhs`. `rhs`
  is evaluated against the *current* namespace; the result is bound to
  `lhs` in the namespace. If names on the right aren't defined yet,
  SymPy's auto-symbol behavior means the assignment just stores a
  symbolic expression (e.g. `x:=a+b` with no prior `a`/`b` stores the
  symbolic expression `a + b`) — matching Nspire's behavior.
- **Equation** — text contains a bare `=` (not part of `:=`, `<=`,
  `>=`, `!=`). Automatically wrapped as `Eq(lhs, rhs)` so
  `solve(x^2 = 4, x)` works without manually writing `Eq(...)`.
- **Expression/statement** — anything else, passed to SymPy as-is
  (function calls like `solve(...)`, `diff(...)`, arithmetic, etc.)

Additional parser conveniences applied before handing text to SymPy:
`^` is accepted as power (translated to `**`), and implicit
multiplication is enabled (`2x`, `(x+1)(x-1)`).

**`=` vs `:=` is strict, never guessed.** A bare `x = a+b` is always
treated as an equation, never silently reinterpreted as an assignment,
even if `x` is undefined and the equation therefore doesn't resolve
`x`. No heuristic guessing between the two forms.

**Re-evaluation model:** cells run top-to-bottom on demand (manually,
or via a "Run All" action). A variable's value reflects whatever the
namespace looked like the last time its defining cell was executed —
not live. To pick up a changed upstream value, re-run the dependent
cell. (Matches Jupyter's and Nspire's line-execution behavior; a full
dependency-graph auto-recalculation engine is out of scope for v1.)

## Notebook persistence

A notebook is a single JSON file (e.g. `derivative-practice.mnb`)
holding an ordered array of cells:

```json
{
  "cells": [
    {"input": "a:=2", "output_latex": "2", "error": null},
    {"input": "b:=4", "output_latex": "4", "error": null},
    {"input": "x:=a+b", "output_latex": "6", "error": null}
  ]
}
```

Only cell input text and cached display output/error are serialized —
never live SymPy objects. Opening a file restores cell text and last
displayed output for reading, but does not rebuild the live namespace;
the namespace is rebuilt by re-running cells (individually, or via
"Run All"). Save is an explicit action (overwrite or "save as"); no
auto-save.

## Error handling

Each cell's evaluation is wrapped individually. Any exception raised
by the pre-processing layer or by SymPy (parse error, unsolvable
input, etc.) is caught and returned as
`{"output_latex": null, "error": "<message>"}`; the cell renders its
error in place and the rest of the notebook is unaffected. No cell
error can crash the app or corrupt the shared namespace.

Two behaviors worth naming as expected (not bugs):
- Referencing a variable that was never assigned treats it as a fresh
  symbolic variable (SymPy auto-symbol behavior) rather than erroring
  — this matches CAS/Nspire convention.
- A typo'd `x = a+b` (meant as assignment) becomes an equation, not an
  assignment, per the strict `=`/`:=` rule above — `x` remains
  undefined afterward. This is accepted behavior, not guarded against.

## Testing

- **Unit tests on the pre-processing/parsing layer** (assignment vs.
  equation vs. expression classification, `^`/implicit-multiplication
  handling) — this is the one piece of genuinely custom logic, and is
  testable in isolation from the UI.
- No automated frontend/UI tests for v1 — manual verification is
  sufficient for a single-user personal tool.
- Manual smoke-test checklist before calling v1 done: assignment,
  equation + `solve`, matrix operations, an error in one cell doesn't
  affect others, and save/reload of a notebook file correctly restores
  and re-runs.
