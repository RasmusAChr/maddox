# Maddox

A free, keyboard-first maths notebook in the spirit of the TI-Nspire, for
Windows and Linux. Claude Code agents do most of the development, so keep
this file, `docs/`, and the tests current when behaviour changes.

The app lives in `app/`: Tauri 2 (Rust shell) + TypeScript + MathLive (2D
input) + Giac (CAS, WebAssembly in a worker). The old Python/SymPy version
is on the `legacy_python` branch; don't delete that branch.

## Product rules (decided by the owner — don't change without asking)

- **Keyboard first.** Everything must work without the mouse. New UI needs
  keys: focus goes somewhere useful, ↑/↓ select, Enter acts, Esc returns to
  the notebook. Clicking empty space must never strand the keyboard.
- **One kind of cell.** Shift+Enter adds a line *inside* the cell. A line
  starting with `#` is text. Enter evaluates every maths line, and each
  result sits beside its line. Separate text blocks were tried and rejected.
- **Matrices are first-class.** Ctrl+M asks for a size. Alt+arrows add rows
  and columns, Alt+Shift+arrows delete them. Every empty cell shows a box,
  and Backspace never leaves a matrix or a bracket half-deleted.
- **Finding things:** Ctrl+P searches every template and app action
  (Obsidian-style). Ctrl+B toggles the template sidebar, which starts
  collapsed to a single » button.
- Full key map: `docs/decisions/0004-keyboard-model.md`, and the F1 dialog
  in `app/index.html`.

## Working on it

Run from `app/`:

```sh
npm install          # also fetches Giac into public/giac/ (sha256-pinned)
npm test             # vitest: converter + real-Giac integration tests
npx tsc --noEmit
npm run dev          # browser at http://localhost:1420
npm run e2e          # keyboard-driven smoke test; needs a dev server on :1420
npm run tauri dev    # desktop window
npm run tauri build  # installers in src-tauri/target/release/bundle/
```

- **After any UI or keyboard change**, run `npm run e2e`.
  `app/e2e/smoke.mjs` is the executable spec of the behaviour the owner
  asked for. Add a check for every new behaviour. The same script can drive
  the built desktop app (see its header).
- **Linux (WebKitGTK) can only be verified in CI**
  (`.github/workflows/app.yml`, Windows + Ubuntu). Check the run after
  pushing UI changes.
- If the owner's `tauri dev` is running, it occupies port 1420. Run e2e
  against it rather than starting a second server, and never kill it.

## Hard rules

- `mathlive` is pinned to an exact version: the code reads MathLive's
  private state. All such access lives in
  `app/src/notebook/mathlive-internals.ts`. Keep it there, and re-run e2e
  after any MathLive upgrade.
- Giac is GPL-3.0, so Maddox is GPL-3.0-or-later. The engine file is never
  committed; `app/scripts/fetch-giac.mjs` downloads it and checks its hash.
- Engine-facing code (`app/src/engine/giac-session.ts`,
  `latex-to-giac.ts`) stays free of DOM and worker globals, so the tests
  can run it against real Giac under Node.

## Where things are

| Path | What |
|---|---|
| `app/src/engine/latex-to-giac.ts` | LaTeX (from MathLive) → Giac syntax |
| `app/src/engine/giac-session.ts` | evaluate, errors, `ans`, decimals, LaTeX cleanup |
| `app/src/engine/engine.ts`, `giac.worker.ts` | worker protocol; `cancel()` restarts the worker |
| `app/src/notebook/notebook.ts` | cells, keys, per-line evaluation and result layout |
| `app/src/notebook/lines.ts` | multi-line cells, `#` text lines |
| `app/src/notebook/matrix.ts`, `mathlive-internals.ts` | matrix editing; all MathLive private access |
| `app/src/ui/commands.ts` | every template and its category (sidebar + search) |
| `app/src/ui/templates.ts`, `dialogs.ts`, `search.ts` | sidebar, Ctrl+P / matrix / help dialogs, matching |
| `app/src/main.ts` | app shell: files, status bar, global keys, click handling |

## Read before changing things

- `docs/gotchas.md`: MathLive, Giac, and platform traps that already cost
  hours. Check it before working around something "weird".
- `docs/decisions/`: why the stack, engine, cell model, and keys are the
  way they are. Add a new record when you make a decision of that weight.
