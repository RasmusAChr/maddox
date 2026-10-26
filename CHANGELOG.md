# Changelog

Newest first. Every fix or feature gets its own section with the next
version number (semantic versioning: a fix bumps the patch, 1.0.0 → 1.0.1;
new or changed behaviour bumps the minor, 1.0.1 → 1.1.0; a notebook file
older versions can't open bumps the major). A release's notes are every
section since the previous release: they become the GitHub Release text
and are shown in the app's update dialog. So write them for students, in
plain words. See `docs/releasing.md`.

## 1.2.1

- Ctrl+Backspace in an empty cell deletes the cell, like Backspace does.
  Before, it did nothing.

## 1.2.0

- Ctrl+Z undoes the last change anywhere in the notebook, and Ctrl+Y (or
  Ctrl+Shift+Z) redoes it. Delete a word and then the whole cell: the
  first Ctrl+Z brings the cell back, the second the word. Typing comes
  back a word at a time. A cell you bring back keeps its answers, and
  what it defined works again.

## 1.1.2

- Behind the scenes: the automatic build and test setup uses current
  versions of GitHub's tools. Nothing changes in the app.

## 1.1.1

- Pressing Esc and then Ctrl+P quickly could open the search without the
  keyboard in it, so what you typed went nowhere. Fixed.

## 1.1.0

- Settings are sorted into tabs: Notebook, Answers, Appearance, and
  Startup & updates. ↑/↓ pick a tab, Enter opens it, Esc goes back.

## 1.0.2

- Typing \ followed by a name (\alp) suggests commands such as \alpha.
  Enter now takes the suggestion; before, it ran the cell with the
  command half typed.

## 1.0.1

- Esc closes Settings on Linux. Before, it did nothing there.
