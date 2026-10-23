# 0005 — Points and vectors: `(a, b, …)`, counting from 1

**Status:** accepted, 2026-10-23. The owner chose the recommendation on all
four questions after comparing GeoGebra, Desmos, TI-Nspire, Maple,
Mathematica, MATLAB/NumPy and Giac.

## Problem

Giac reads `(1, 3)` as a *sequence*: loose numbers, not a point. It
printed as `1,3`, its decimal came out as `8,15,6`, and arithmetic was
silently wrong (`Q − P = 7`, `2P = 6`). The owner uses Maddox for machine
learning (matrices, vectors, normal equations). The notation also has to
make sense internationally, work for students who only write points, and
carry over to plotting later.

## What other programs do

- GeoGebra and Desmos: `(1, 3)` is a point, it computes like a vector, and
  x and y are easy to get at. Both count from 1. GeoGebra and Desmos stop at
  2D/3D.
- TI-Nspire, Maple, Mathematica, MATLAB: vectors are lists or matrices of
  any length (`{1,3}`, `<1,3>`, `[1 3]`). All count from 1.
- Giac and Python: 0-based. Giac has no point type in plain syntax.
- Textbooks everywhere, and ISO 80000-2, write coordinates as `(x, y, z)`.

## Decision

1. **Round brackets with a comma are a vector of any length**: `(1, 3)`,
   `(1, 3, 5)`, `(x₁, …, xₙ)`. It is shown as `(1, 3)` and computes like a
   vector: `Q − P`, `2P`, `(P + Q)/2`, `|Q − P|`, `P·Q` (dot product),
   `cross`. Internally it is Giac's `ggbvect`.
   - Not a point: `f(1, 3)` when f is a function (a call), `solve(…)` and
     other commands, `(x, y) → x + y` (parameters), `\{1, 2\}`.
   - `b(1, 3)` where b is not a function: b times the point.
2. **Matrices are unchanged** (Ctrl+M, exact sizes). Matrix × point gives
   a point. **A point or list with a column matrix gives a column**: the
   point is turned into a column first. This is friendlier for ML than
   MATLAB-style "sizes don't fit".
3. **`[1, 3]` stays a list**, and a list of points `[(1, 3), (3, 8)]` stays
   a list of points (not a 2×2 matrix). Ready for plotting as a scatter.
4. **Positions count from 1**: `P[1]` is x, `M[2, 1]` is row 2, column 1.
   `v[0]` is an error ("Positions start at 1").
5. **Not yet:** coordinates by name (`P.x` as in Desmos, or `x(P)` as in
   GeoGebra). `x(P)` clashes with implied multiplication. `P[1]` covers it
   for now.

## Consequences

- Converter: `group()` marks round-bracket groups with a top-level comma,
  `Emitter.push` decides call / product / point, `fromOne` shifts indexes.
- Session: `resolveCalls` makes `b(1,3)` a product with a point.
  `shapedLatex` renders points and lists of points (Giac's `latex()` can't),
  and also fixes the old `evalf(seq, digits)` bug. `operands` +
  `asColumns` handle points mixed with columns.
- Giac details and traps: `docs/gotchas.md`, section Giac.
