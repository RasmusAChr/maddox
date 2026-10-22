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
  `*` between touching operands, except for a name directly followed by
  `(`, which Giac resolves itself (call versus product).
- **`ans` is reserved**, and `Ans` follows internal calls. We use our own
  `maddox_ans`.
- **`restart` breaks the result holder.** It returns the names it cleared,
  including `maddox_result`, so `maddox_result:=(restart)` is a "recursive
  definition" error. `GiacSession.evaluate` special-cases a bare `restart`.
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
- **WebKitGTK (Linux) navigation:**
  - MathLive's `move-out` event is unreliable at the top and bottom rows,
    so ↑/↓ also move between cells when the caret provably did not move.
  - Focusing a field right after removing a sibling can throw or land on
    `<body>`, so `ensureFocused()` retries with backoff.
- **Clicks on empty space.** They move focus to `<body>`. The global
  `mousedown` handler in `main.ts` prevents that, except on real controls
  and scrollbars.
- **`tar` and Windows paths.** GNU tar (from Git Bash) reads `C:\…` as a
  remote host. `fetch-giac.mjs` runs tar with relative paths in a working
  directory.
- **Port 1420.** The owner's `tauri dev` uses it. A Vite server started by
  an agent survives the agent's task being stopped on Windows, so find it
  by command line and kill only your own.
