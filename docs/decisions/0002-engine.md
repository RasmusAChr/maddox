# 0002 — Engine: Giac (WebAssembly) in a Web Worker

**Status:** accepted, 2026-10-22.

## Decision

- **Which build.** We use Giac compiled to WebAssembly by its author,
  Bernard Parisse (`giacwasm.js`, about 19 MB with the wasm embedded).
  `app/scripts/fetch-giac.mjs` downloads it during `npm install` from
  `www-fourier.univ-grenoble-alpes.fr/~parisse/giacjs.tar.gz` and checks a
  pinned sha256. If upstream republishes, install fails on purpose: review
  the new build, then update the hash. The file is never committed.
- **Where it runs.** It runs in a module Web Worker
  (`app/src/engine/giac.worker.ts`). The script is a classic Emscripten
  script, so it is loaded with fetch plus indirect `eval`. That is why the
  Tauri CSP allows `'unsafe-eval'` and `'wasm-unsafe-eval'`.
- **Cancelling.** Esc kills the worker and starts a new one
  (`Engine.cancel()`). That clears every user variable, and the UI says so.
- **Evaluation** is in `app/src/engine/giac-session.ts`:
  - Every input is stored with `maddox_result:=(…)`, so its LaTeX and
    decimal value can be read back without evaluating it twice.
  - The display uses `latex(regroup(…))`. `regroup` collects like terms
    (x+x becomes 2x), as Xcas does by default. It is not a full simplify,
    so `(x²−1)/(x−1)` stays as typed; the user can call `simplify()`.
  - A decimal approximation is shown only when it adds information: the
    exact form is not already a decimal, and the value is purely numeric.
  - `ans` maps to the variable `maddox_ans`.
- **Angle mode** (per notebook, chosen by the owner 2026-10-23):
  - Giac's `angle_radian` (0 = degrees) does the work.
  - `°` converts to `*maddox_deg`, which is π/180 in radian mode and 1 in
    degree mode, so `30°` always means 30 degrees.
  - `GiacSession` re-applies both after every `restart`.
  - `Engine` re-sends the mode to a restarted worker after Esc-cancel.
  - In degree mode calculus picks up π/180 factors (d/dx sin x =
    π/180·cos x), as on the TI-Nspire.
- **Readable answers** (chosen by the owner 2026-10-23):
  - `solve`/`csolve`/`fsolve` answers read "x = 2 or x = 3", "No solution",
    "x = 2 and y = 1". A Ctrl+P option shows them as sets
    ("x ∈ {2, 3}", "∅", "(x, y) = (2, 1)"). The option is a display
    preference of the computer, not of the notebook
    (`GiacSession.formatSolve`).
  - Decimals show 6 significant digits and use ·10ⁿ for very small or
    large numbers. A digits setting will come with the Settings dialog;
    `approx(…, n)` keeps the n digits asked for.
  - π and roots read as written: π/6, √2/2 (`cleanLatex`).
  - Errors are in plain words (`findError`), including the cases where
    Giac silently gives a wrong answer (see gotchas).
- **Input conversion.** MathLive produces LaTeX, and
  `app/src/engine/latex-to-giac.ts` converts it. TI conventions apply:
  `log` is base 10, and `xy` is one variable.

## Licence

Giac is GPL-3.0, so Maddox is GPL-3.0-or-later (`app/LICENSE`).

## Alternatives considered

- Linking native Giac into Rust: faster startup, but building Giac on
  Windows is hard (GMP/MPFR via MSYS2). Revisit if WebAssembly speed or
  memory becomes a problem. The engine sits behind `Engine`, so swapping it
  is local.
- SymPy (legacy) and CortexJS Compute Engine: too slow, or not a real CAS.
