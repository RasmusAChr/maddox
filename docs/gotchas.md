# Gotchas

Traps that already cost real debugging time. Each entry gives the symptom,
the cause, and where the workaround lives. Add new ones here.

## MathLive (pinned at 0.111.1)

All private-state access is in `app/src/notebook/mathlive-internals.ts`.
Re-check this list after upgrading.

- **Focus is delayed by 60 ms.** `mf.focus()` hands the keyboard over only
  after a `setTimeout(…, 60)` in `onFocus`, so keys typed in between land
  in the previously focused field. The timer also steals focus back if
  focus returns, within those 60 ms, to the element that had it when
  `focus()` was called (for example, Enter inserts a template, then Ctrl+B
  reopens the sidebar search). Fix: `focusImmediately()` blurs the previous
  element, calls `focus()`, then focuses the internal `keyboardDelegate`.
  Always use it instead of `mf.focus()`.
- **Options throw before the field is mounted.** Reading or writing
  `keybindings` or `inlineShortcuts` throws "Mathfield not mounted" until
  the element is in the DOM. Insert it first, then configure it
  (`Notebook.createEntry`).
- **One-character arguments lose their braces.** The value is serialised as
  `\frac13`, `x^2`, `\sqrt2`. The converter's `arg()` takes exactly one
  character when there is no brace. Reading `13` as one argument was a
  real bug.
- **smartSuperscript.** After one digit in an exponent, MathLive leaves the
  exponent automatically, so typing `2^256` gives 2²·56. Tests must not
  press → after `^2`; type `^2+1` directly.
- **`/` keeps the caret in the denominator.** `1/3+1/6` typed straight
  through gives `1/(3+1/6)`. Press → after the denominator (as on the
  Nspire).
- **Unwanted default keybindings.** Esc switches to raw-LaTeX mode. Ctrl,
  Alt or Cmd+Enter and Alt+Tab add rows and columns, and on a
  non-matrix expression they convert it into a matrix. All are removed in
  `Notebook.configure`.
- **Multi-line values have two forms.** `addRowAfter` at the top level
  turns the field into a multi-line array. The value reads
  `\displaylines{a\\ b}` when built by keyboard, but `a\\ b` after a value
  was set and read back. Both load as multi-line. `splitLines()` handles
  both and ignores `\\` inside matrices and braces.
- **Text mode needs real typing.** `executeCommand(["switchMode","text"])`
  followed by `typedText` sticks; `mf.insert(…, {mode:"text"})` does not.
  On non-US layouts (e.g. Danish) MathLive has no key for text mode, which
  is why `#` is handled in our own keydown handler.
- **New columns have no boxes.** `addColumnBefore/After` creates empty
  cells without placeholders (rows get them), and nothing refills a cell
  once it is emptied. Deleting a cell's box fires no `input` event.
  `fillEmptyMatrixCells()` runs after matrix edits, on input, and on the
  next frame after Backspace/Delete. It builds placeholders with
  MathLive's own (unexported) class, taken from a hidden probe field.
- **Brackets delete one side at a time.** Backspace at the start of
  `solve(…)` removes only `(`, leaving `\left.`. Delete on empty `()`
  removes only `)`. Ctrl+Backspace at a group's start does nothing. Fix:
  `deleteAtBrackets()`; a function name is any atom with `isFunction`.
- **Ctrl+←/→ get stuck.** MathLive binds them to move to the start or end
  of the current group, so at a group's edge (e.g. right before the `(` of
  `transpose(A)`) they do nothing. Its Alt+arrows (word moves) step through
  the letters inside a function name. Fix: `moveByWord()`, which crosses
  one atom or one letter run per press and leaves a group at its edge.
- **`input` events lag behind keystrokes.** MathLive dispatches `input`
  from a `setTimeout(0)`, so an "unsaved" flag set there is briefly stale:
  a Ctrl+N right after typing would discard the edit unasked. `main.ts`
  decides "unsaved changes?" by comparing the content with the last saved
  content (`hasUnsavedChanges`), not by the flag alone.
- **Forcing a re-render.** After editing the model directly, request a
  render with `mf.placeholderSymbol = mf.placeholderSymbol` (a public
  setter that calls `requestUpdate`).
- **Matrix results need `pmatrix`.** Giac's `\left(\begin{array}…\right)`
  renders with misaligned brackets and pastes back as uneditable.
  `cleanLatex()` rewrites it to `pmatrix`.

## Giac (giacwasm.js)

- **Syntax errors only appear in print output.** `caseval` returns `undef`
  and the message goes to `Module.print`. `GiacSession` collects printed
  lines per call. Other errors come back as `GIAC_ERROR: …`.
- **Answers carry a decimal tail.** `caseval` adds `=0.5` to exact answers
  at the top level, so never parse its text output. Read
  `latex(regroup(maddox_result))` and `evalf(…)` separately.
- **No implicit multiplication between brackets.** `(x+1)x` and
  `sin(x)cos(x)` are syntax errors, and `x y` too. The converter inserts
  `*` between touching operands.
- **A name before `(` is ambiguous, and Giac guesses wrong.** `3*x(4*y+8*z)`
  calls `x` as a function and returns `12*y+24*z`. The converter marks a
  typed name followed by `(` with `CALL_OR_PRODUCT`, and
  `GiacSession.resolveCalls` decides:
  - a call if `type(name)` is `func` (built-in or user-defined), or if the
    brackets are followed by `:=` (a definition such as `f(x):=…`);
  - otherwise `name*(…)`.

  Names from `\operatorname{…}` (solve, det, …) are always calls.
- **`ans` is reserved**, and `Ans` follows internal calls. We use our own
  `maddox_ans`.
- **`restart` breaks the result holder.** It returns the names it cleared,
  including `maddox_result`, so `maddox_result:=(restart)` is a "recursive
  definition" error. `GiacSession.evaluate` special-cases a bare `restart`.
- **`restart` resets the angle mode to radians.** It also clears
  `maddox_deg`. `GiacSession.reset()` re-applies both.
- **Display simplification.** Autosimplify settings do not affect
  `caseval`. Results are wrapped in `regroup()` for display.
- **Loading under Node.** The script declares `var Module` at the top
  level. Under Node, run it with `vm.runInThisContext`, not `require`
  (see `giac-session.test.ts`).
- **Slow inputs, for tests.** `ifactor(2^256+1)` takes about 15 s, and is
  used to test Esc. Type the number in full, because of smartSuperscript.

## Platform and DOM

- **`<dialog>` closes late.** Its `close` event fires a task after focus
  has already returned, so a fast keystroke lands before the inserted text.
  Dialog actions run synchronously through `finish()` in `dialogs.ts`.
- **WebView2: typing dead after a dialog closes.** A closing `<dialog>`
  hands focus back to the cell by itself. In the desktop app, focus restored
  that way could leave Windows' text input (TSF) detached: the caret blinks,
  but typed characters go nowhere until the cell is left and re-entered.
  Automated tests (CDP) inject keys past TSF and cannot reproduce it.
  `dropRestoredFocus()` in `dialogs.ts` blurs the restored cell, so the
  caller's focus is a real one. Never rely on dialog focus restoration for
  a math-field.
- **WebKitGTK (Linux) navigation:**
  - MathLive's `move-out` event is unreliable at the top and bottom rows,
    so ↑/↓ also move between cells when the caret provably did not move.
  - Focusing a field right after removing a sibling can throw or land on
    `<body>`, so `ensureFocused()` retries with backoff.
- **Scrollbars around results.** `overflow-x: auto` on one axis forces
  `overflow-y: auto` on the other, so the result column became a scroll box
  as soon as a matrix's brackets overhung by a pixel. The result column must
  never be a scroll container:
  - results that don't fit wrap below the input;
  - only a single result wider than the whole cell gets `.wide`
    (its own sideways scroll), decided in `Notebook.layoutResults` against
    the cell's width, not the row's (glyph overhang gives false positives);
  - results are right-aligned with an auto margin, not
    `justify-content: flex-end`, which overflows off the left edge where it
    can't be scrolled or measured.
- **The page grew wider than the window.** A grid column sized `auto`
  grows to the widest content (a huge result), pushing the notebook
  off-screen. `body` uses `grid-template-columns: minmax(0, 1fr)`.
- **Clicks on empty space.** They move focus to `<body>`. The global
  `mousedown` handler in `main.ts` prevents that, except on real controls
  and scrollbars.
- **`tar` and Windows paths.** GNU tar (from Git Bash) reads `C:\…` as a
  remote host. `fetch-giac.mjs` runs tar with relative paths in a working
  directory.
- **Testing the desktop app without touching the owner's data.** The
  built exe shares its WebView2 profile (localStorage: autosaved session,
  recent files, zoom) with the owner's own runs. Start it with
  `WEBVIEW2_USER_DATA_FOLDER=<a scratch folder>` (plus
  `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9333` to
  drive it over CDP). To test the close prompt, use
  `Process.CloseMainWindow()` (the same message as clicking X). The page
  itself may not invoke `plugin:window|close`; the capability doesn't
  allow it.
- **Port 1420.** The owner's `tauri dev` uses it. A Vite server started by
  an agent survives the agent's task being stopped on Windows, so find it
  by command line and kill only your own.
