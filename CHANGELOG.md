# Changelog

Newest first. Every fix or feature gets its own section with the next
version number (semantic versioning: a fix bumps the patch, 1.0.0 → 1.0.1;
new or changed behaviour bumps the minor, 1.0.1 → 1.1.0; a notebook file
older versions can't open bumps the major). A release's notes are every
section since the previous release: they become the GitHub Release text
and are shown in the app's update dialog. See `docs/releasing.md`.

Users read these notes, so write for students, in plain words: what they
can do now, not what went wrong before or how it was fixed. Keep each
bullet to one short sentence or two; the docs and the F1 help have the
details. Sort each
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

## 1.6.0

### Improved

- The update window shows what's new as tidy headings and lists.

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

- Print your notebook or save it as a PDF with Ctrl+Shift+P.
- Copy the answer on your line with Ctrl+Shift+C.

## 1.4.0

### New

- Suggestions as you type: after two letters, Maddox suggests a name or
  function in grey. Press Tab to use it.

### Improved

- Backspace in an empty box of a function deletes the whole function.

### Fixed

- Long names like `determinant` no longer turn into functions while you
  type them.

## 1.3.0

### New

- About Maddox (search "about" in Ctrl+P) shows the version and the
  licences.

### Behind the scenes

- Building Maddox downloads the maths engine from Maddox's own GitHub
  release instead of a university server.

## 1.2.2

### Behind the scenes

- Holding Ctrl+Z (the notebook-wide undo, new in 1.2.0) on Linux keeps
  undoing until you let go, instead of sometimes typing z's into the
  notebook.

## 1.2.1

### Fixed

- Ctrl+Backspace deletes an empty cell, like Backspace does.

## 1.2.0

### New

- Undo and redo anything in the notebook with Ctrl+Z and Ctrl+Y, even a
  deleted cell.

## 1.1.2

### Behind the scenes

- The automatic build and test setup uses current versions of GitHub's
  tools.

## 1.1.1

### Fixed

- Typing in the search (Ctrl+P) works when you open it right after
  pressing Esc.

## 1.1.0

### Improved

- Settings are split into tabs, so they are easier to find.

## 1.0.2

### Fixed

- Enter picks a suggested symbol (typing `\alp` suggests `\alpha`)
  instead of running the cell.

## 1.0.1

### Fixed

- Esc closes Settings on Linux.

## 1.0.0

The first release of Maddox, a keyboard-first maths notebook.
