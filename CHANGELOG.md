# Changelog

Newest first. Every fix or feature gets its own section with the next
version number (semantic versioning: a fix bumps the patch, 1.0.0 → 1.0.1;
new or changed behaviour bumps the minor, 1.0.1 → 1.1.0; a notebook file
older versions can't open bumps the major). A release's notes are every
section since the previous release: they become the GitHub Release text
and are shown in the app's update dialog. So write them for students, in
plain words. See `docs/releasing.md`.

## 1.1.0

- Settings are sorted into tabs: Notebook, Answers, Appearance, and
  Startup & updates. ↑/↓ pick a tab, Enter opens it, Esc goes back.

## 1.0.2

- Typing \ followed by a name (\alp) suggests commands such as \alpha.
  Enter now takes the suggestion; before, it ran the cell with the
  command half typed.

## 1.0.1

- Esc closes Settings on Linux. Before, it did nothing there.
