# 0009: Releases and updates

**Status:** accepted, 2026-10-24.

## Decisions (by the owner)

1. **Updates are offered, never forced.** The app checks quietly at startup
   and once a day. A newer version shows a `↑ 0.2.0` chip in the status bar
   and an "Install Maddox 0.2.0" action in Ctrl+P. Nothing installs until
   the user presses Enter in the update dialog, and unsaved work is asked
   about first. Settings → Startup and files turns the check off.
   Rejected: a manual check only (most people would never update), and
   silent install on close (the app changes under a student mid-term, and
   the installer closing the app clashes with the unsaved-changes guard).
2. **The repository becomes public** and holds the releases. The updater
   needs a public `latest.json`, and the GPL needs the source available.
3. **Windows installers are unsigned for now.** SmartScreen warns on the
   first install ("More info → Run anyway"). We can add signing later
   (Azure Trusted Signing, SignPath's free open-source program, or a
   certificate) without changing anything else.

## How

- Tauri's updater plugin with a minisign key (`docs/releasing.md`). Every
  installer type updates itself: NSIS/MSI on Windows; AppImage, .deb and
  .rpm on Linux (the last two through pkexec).
- `package.json` is the only place the version is written:
  `tauri.conf.json` reads it, and `npm run release` also keeps
  `Cargo.toml` in step.
- A tag `v*` builds a **draft** release. A person publishes it, so a bad
  build never reaches users on its own.
- `CHANGELOG.md` is where the release notes come from: the GitHub Release
  text and the update dialog both use its section.
