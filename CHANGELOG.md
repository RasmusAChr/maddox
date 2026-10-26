# Changelog

Newest first. Every fix or feature gets its own section with the next
version number (semantic versioning: a fix bumps the patch, 1.0.0 → 1.0.1;
new or changed behaviour bumps the minor, 1.0.1 → 1.1.0; a notebook file
older versions can't open bumps the major). A release's notes are every
section since the previous release: they become the GitHub Release text
and are shown in the app's update dialog. So write them for students, in
plain words. See `docs/releasing.md`.

## 1.4.0

- Names no longer change while you type, so `determinant` or `solution1`
  stay one name (before, det or sin turned into a function halfway).
- After two letters, a suggestion shows in grey: `so` suggests
  `solve(…, x)`, a name you defined, or a Greek letter (`th` → θ). Tab
  takes it; Esc hides it. `sin`, `pi`, `sqrt` and the others now come
  from Tab, or the sidebar.
- Backspace on an empty template box (from the sidebar or Tab) deletes the
  whole function, not just its brackets.

## 1.3.0

- About Maddox (Ctrl+P, "about") shows the version, the licences, and
  where the source code of Maddox and its maths engine can be found.
- Maddox downloads its maths engine from its own GitHub release, so
  building it no longer depends on a university server being up.

## 1.2.2

- Holding Ctrl+Z on Linux could type "zzzz" into a cell that undo had
  just brought back. Holding it now keeps undoing until you let go.

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

## 1.0.0

The first release of Maddox, a keyboard-first maths notebook.
