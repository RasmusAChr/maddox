# Changelog

Newest first. Every fix or feature gets its own section with the next
version number (semantic versioning: a fix bumps the patch, 1.0.0 → 1.0.1;
new or changed behaviour bumps the minor, 1.0.1 → 1.1.0; a notebook file
older versions can't open bumps the major). A release's notes are every
section since the previous release: they become the GitHub Release text
and are shown in the app's update dialog. See `docs/releasing.md`.

Users read these notes, so write for students, in plain words: what they
can do now, not what went wrong before or how it was fixed. Sort each
bullet under one of these headings, in this order:

- `### New`: something you couldn't do before.
- `### Improved`: something that works better or more conveniently.
- `### Fixed`: something that went wrong and now doesn't.
- `### Behind the scenes`: changes users don't notice (build, tests).
  Kept here for developers; left out of the release notes.

A fix to something that hasn't been released yet (it came in a section
since the last release's tag) goes under `### Behind the scenes`: no user
ever met that bug. If it changes what the feature does, reword the
feature's own bullet instead.

## 1.5.2

### Behind the scenes

- Printing (new in 1.5.0) on Linux: the top bar no longer flickers, and
  cancelling the print dialog brings the notebook straight back.

## 1.5.1

### Behind the scenes

- Ctrl+Z right after taking a suggestion (new in 1.4.0) with Tab takes
  back only the suggestion, not the letters you typed.

## 1.5.0

### New

- Print your notebook, or save it as a PDF, with Ctrl+Shift+P. The page
  shows only your calculations, laid out like on screen, with the
  notebook's name and the date on top.
- Ctrl+Shift+C copies the result of the line you are on, as plain text
  (`1/2 ≈ 0.5`). Ctrl+P → "Copy result as LaTeX" copies it as LaTeX.

## 1.4.0

### New

- Suggestions while you type: after two letters, the best match shows in
  grey (`so` → `solve(…, x)`, a name you defined, or a Greek letter like
  `th` → θ). Tab takes it, Esc hides it. Functions such as `sin`, `pi` and
  `sqrt` now come from Tab or the sidebar.

### Improved

- Names stay as you type them, so `determinant` or `solution1` are one
  name instead of turning into a function halfway.
- Backspace on an empty box of a function (from the sidebar or Tab)
  deletes the whole function, not just its brackets.

## 1.3.0

### New

- About Maddox (Ctrl+P, "about") shows the version, the licences, and
  where to find the source code of Maddox and its maths engine.

### Behind the scenes

- Building Maddox downloads the maths engine from Maddox's own GitHub
  release instead of a university server.

## 1.2.2

### Behind the scenes

- Holding Ctrl+Z (the notebook-wide undo, new in 1.2.0) on Linux keeps
  undoing until you let go, instead of sometimes typing z's into the
  notebook.

## 1.2.1

### Improved

- Ctrl+Backspace in an empty cell deletes the cell, like Backspace.

## 1.2.0

### New

- Undo and redo across the whole notebook: Ctrl+Z takes back the last
  change wherever it was, and Ctrl+Y (or Ctrl+Shift+Z) redoes it. Delete
  a word and then the whole cell: the first Ctrl+Z brings the cell back,
  the second the word. Typing comes back a word at a time, and a cell you
  bring back keeps its answers.

## 1.1.2

### Behind the scenes

- The automatic build and test setup uses current versions of GitHub's
  tools.

## 1.1.1

### Fixed

- The search (Ctrl+P) always gets your typing, even when you open it
  right after pressing Esc.

## 1.1.0

### Improved

- Settings are sorted into tabs: Notebook, Answers, Appearance, and
  Startup & updates. ↑/↓ pick a tab, Enter opens it, Esc goes back.

## 1.0.2

### Improved

- Enter takes a suggested command such as `\alpha` (after typing `\alp`)
  instead of running the cell.

## 1.0.1

### Improved

- Esc closes Settings on Linux too.

## 1.0.0

The first release of Maddox, a keyboard-first maths notebook.
