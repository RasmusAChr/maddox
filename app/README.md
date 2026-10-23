# Maddox (Tauri prototype)

A keyboard-first maths notebook in the spirit of the TI-Nspire, for Windows
and Linux.

- **Shell:** [Tauri 2](https://tauri.app) (Rust). It uses the system webview:
  WebView2 on Windows, WebKitGTK on Linux.
- **Input:** [MathLive](https://cortexjs.io/mathlive/) math-fields. The entry
  you type is LaTeX.
- **Engine:** [Giac](https://www-fourier.univ-grenoble-alpes.fr/~parisse/giac.html)
  (the CAS behind Xcas and the HP Prime), compiled to WebAssembly by its
  author. It runs in a Web Worker, so long computations never freeze typing
  and can be cancelled with Esc.

## How an entry is evaluated

```
math-field (LaTeX) ──latexToGiac──▶ Giac syntax ──worker──▶ caseval()
                                                              │
result row ◀──cleanLatex── latex(regroup(result)) + evalf ◀───┘
```

- `src/engine/latex-to-giac.ts`: LaTeX → Giac. Inserts explicit `*` for
  juxtaposition, and handles fractions, roots, matrices, ∫, Σ, lim and d/dx.
- `src/engine/giac-session.ts`: evaluation, error extraction, the `ans`
  variable, and the decimal approximation. It has no DOM or worker code, so
  the tests run it against the real engine under Node.
- `src/engine/engine.ts` + `giac.worker.ts`: the worker protocol.
  `cancel()` kills and restarts the worker, which clears all variables.
- `src/notebook/`: entries, keyboard handling, matrix editing.
  `mathlive-internals.ts` holds the only code that touches MathLive's private
  state, which is why `mathlive` is pinned to an exact version.

## Commands

```sh
npm install          # also downloads Giac (~19 MB, sha256-pinned) to public/giac/
npm test             # unit tests + Giac integration tests (vitest)
npm run dev          # browser at http://localhost:1420
npm run e2e          # keyboard-driven browser test; needs `npm run dev` running
npm run tauri dev    # desktop window with hot reload
npm run tauri build  # installers in src-tauri/target/release/bundle/
```

Prerequisites: Node 20+, Rust (rustup), and the platform's Tauri dependencies.

- **Windows:** Visual Studio C++ Build Tools. WebView2 ships with Windows 11.
- **Linux (Debian/Ubuntu):** `sudo apt install libwebkit2gtk-4.1-dev
  build-essential curl wget file libxdo-dev libssl-dev
  libayatana-appindicator3-dev librsvg2-dev`

## Keyboard

Press F1 in the app for the full list. The important keys:

| Key | Action |
|---|---|
| Enter | Evaluate every maths line of the entry, then move on |
| Shift+Enter | New line in the same entry |
| `#` at the start of a line | That line is text: shown, never evaluated |
| Ctrl+Enter | New entry below |
| Ctrl+M | Insert a matrix (choose its size) |
| Alt+↓ / Alt+↑ | Add a matrix row below / above |
| Alt+→ / Alt+← | Add a matrix column right / left |
| Alt+Shift+arrows | Delete the current row / column |
| Ctrl+P | Search every template and app command (Ctrl+K works too) |
| Ctrl+B | Show or hide the template sidebar (collapses to a rail of category icons) |
| Esc | Cancel a running computation |
| Ctrl+Shift+A | Degrees / radians for this notebook (`30deg` types 30°, which is always degrees) |

## Notes

- Notebooks are saved as `.maddox` files: JSON holding a list of entries,
  each `{"latex": ...}`. A multi-line entry is `\displaylines{...}` (see
  `src/notebook/lines.ts`). Results are recomputed on open.
- Giac is GPL-3.0, so Maddox is GPL-3.0-or-later as well.
