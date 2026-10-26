# Releasing Maddox

A release is a GitHub Release on `RasmusAChr/maddox` with the installers,
the signed updates, and `latest.json`, which the app's updater reads.

## Once: the update signing key

Updates are signed so the app only installs files we made. This key is not
Windows code signing (Maddox ships unsigned for now; SmartScreen warns on
the first install).

1. `npx tauri signer generate -w ~/.tauri/maddox.key` (in `app/`), with a
   password. **Back up the key file and the password.** Without them,
   installed copies can never be updated again.
2. Put the public key (`~/.tauri/maddox.key.pub`, its contents) in
   `app/src-tauri/tauri.conf.json` → `plugins.updater.pubkey`, and commit.
3. Add two repository secrets on GitHub (Settings → Secrets → Actions):
   `TAURI_SIGNING_PRIVATE_KEY` (the contents of `maddox.key`) and
   `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`.

The repository must be public: the app downloads `latest.json` and the
installers without logging in, and the GPL asks for the source to be
available alongside the binaries.

## Each release

Work happens on feature branches, which are merged into `development`.
`main` is always the latest release (see "Branches" in `CLAUDE.md`).

1. Check the notes on `development`. Every fix or feature already has its
   own `CHANGELOG.md` section with its own version (see the top of that
   file), so the release version is the top section's. The release notes
   are every section since the previous release's tag. Preview them with
   `node scripts/release.mjs --notes 1.2.3`.
2. Open a pull request from `development` to `main`, let CI pass, and
   merge it. Then `git switch main && git pull`, and in `app/`:
   `npm run release -- 1.2.3`. It writes
   the version into `package.json` and `Cargo.toml` (`tauri.conf.json`
   reads it from `package.json`), commits "Release 1.2.3" and tags
   `v1.2.3`. It refuses without notes, with uncommitted changes, or if the
   tag exists.
3. `git push origin main v1.2.3`. `.github/workflows/release.yml` builds on
   Windows and Ubuntu and fills a **draft** release. Its last job checks
   that `latest.json` lists both Windows and Linux.
4. Look at the draft on GitHub, and install one of its files if you like.
   Press **Publish**. From then on, running copies see the update within a
   day (at their next start, or at their daily check).
5. Bring the "Release 1.2.3" commit back:
   `git switch development && git merge main && git push`. This keeps
   the version in `development` in step with `main`.

## The engine mirror

Builds take Giac from a pre-release of this repository,
`engine-giac-<version>`, and fall back to the original on the Grenoble
server (`app/scripts/fetch-giac.mjs`). Both must match `EXPECTED_SHA256`.

To move to a new Giac build:

1. Download the new `giacjs.tar.gz` from upstream, test Maddox with it, and
   update `EXPECTED_SHA256`.
2. Upload it as a new mirror (from the folder holding the archive):

   ```sh
   gh release create engine-giac-<version> giacjs.tar.gz      --prerelease --latest=false      --title "Giac <version> (engine mirror)"      --notes "Unchanged copy of Giac (GPL-3, B. Parisse and R. De Graeve) used to build Maddox. Source: https://www-fourier.univ-grenoble-alpes.fr/~parisse/giac.html"
   ```

   **It must be a pre-release and never "latest":** the in-app updater reads
   `releases/latest/download/latest.json`, so a mirror marked latest would
   stop every installed Maddox from finding updates. The tag doesn't start
   with `v`, so it doesn't start the release workflow.
3. Point the first entry of `SOURCES` in `fetch-giac.mjs` at the new tag,
   and update the Giac line in the About dialog (`app/index.html`).

## Versions

`major.minor.patch`. Bump the patch for fixes, the minor for new features.
A new file format that older versions can't open is a major change.

## What the app does

- At startup (after 3 s) and once a day, unless Settings → Startup and
  files → Check for updates is Off, it asks for
  `releases/latest/download/latest.json` (drafts and pre-releases are not
  "latest"). Failing (offline, no release) is silent.
- A newer version shows `↑ 1.2.3` in the status bar, and Ctrl+P lists
  "Install Maddox 1.2.3". Ctrl+P "Check for updates" checks at once and
  says what it found.
- Installing: the update dialog (Enter installs, Esc later), then "Save
  changes?" if needed, then download, install and restart. On Windows the
  installer runs passively (a progress window) and restarts Maddox; a .deb
  or .rpm asks for the admin password (pkexec); an AppImage replaces
  itself.
- In `npm run dev` there is no updater. The e2e test sets
  `localStorage["maddox.fake-update"] = {"version": "9.9.9"}` to pretend
  one exists (`src/updates.ts`).
