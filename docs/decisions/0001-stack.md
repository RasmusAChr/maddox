# 0001 — Stack: Tauri 2 + TypeScript + MathLive + Giac

**Status:** accepted, 2026-10-22. It replaced the Python version, which is
kept on the `legacy_python` branch.

## Context

Maddox must run well on Windows and Linux, be keyboard-first, and feel like
a TI-Nspire calculator. Claude Code agents are the main developers, so
strict types, good tests, and a compiler that catches mistakes matter more
than what a human developer finds comfortable.

The legacy app was Python: pywebview + SymPy + a hand-wired MathLive page.
Python was not the cause of its UX problems; the interface was already
HTML. Its real weaknesses were the shell (pywebview: few native features,
clumsy PyInstaller packaging, flagged by antivirus, slow start) and SymPy
(slow, and it needs a Python runtime bundled with the app).

## Decision

- **Interface: web technology.** Whatever draws the 2D maths editor decides
  everything else, and MathLive is far better than anything we could write
  in a native toolkit.
- **Shell: Tauri 2.** It gives small installers (.msi/.exe/.deb/.AppImage/
  .rpm), native dialogs, and an updater. It uses the system webview:
  WebView2 on Windows, WebKitGTK on Linux.
- **Engine: Giac** (the CAS behind Xcas and the HP Prime). It is fast,
  gives exact and approximate answers, and its behaviour is close to a
  calculator's. It is GPL-3. See [0002](0002-engine.md).
- **Language: TypeScript**, vanilla DOM, no UI framework. The UI is small,
  and MathLive is a web component anyway.

## Rejected

- **Native toolkits** (Qt/PySide, Slint, egui, Avalonia, GTK): none has a
  usable 2D maths editor. Writing one is months of work.
- **pywebview + Python:** the weakest shell (see Context).
- **Electron:** consistent Chromium everywhere, but 100 MB+ and heavier.
  This is the fallback (see below).
- **SymPy as a bundled Python process:** slow, and it needs a Python
  runtime bundled with the app.

## Consequences

- Linux renders through WebKitGTK. Tauri documents NVIDIA problems (blank
  windows, flicker) and slow WebGL there. Avoid WebGL in future graphing;
  use SVG or a 2D canvas. If WebKitGTK becomes a blocker, move to Electron.
  The frontend carries over unchanged.
- Some WebKitGTK quirks are already handled in code; see
  [../gotchas.md](../gotchas.md).
- The MathLive version is pinned exactly, because we read its private
  state.
