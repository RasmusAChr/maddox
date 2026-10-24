// Prepares a release: `npm run release -- 0.2.0`
//   Checks that the working tree is clean, that the tag is new, and that
//   CHANGELOG.md (repo root) has a "## 0.2.0" section; writes the version
//   into package.json (+ lock) and Cargo.toml (+ lock); commits "Release
//   0.2.0" and tags v0.2.0. It does not push: `git push origin main v0.2.0`
//   starts .github/workflows/release.yml, which builds a draft GitHub Release.
// `node scripts/release.mjs --notes 0.2.0` prints that version's notes (the
// workflow uses it for the release text and the in-app update dialog).
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const app = fileURLToPath(new URL("..", import.meta.url));
const root = fileURLToPath(new URL("../..", import.meta.url));

/** The text under "## <version>" in CHANGELOG.md, up to the next "## ". */
function releaseNotes(changelog, version) {
  const lines = changelog.split(/\r?\n/);
  const start = lines.findIndex((l) => new RegExp(`^## ${version.replaceAll(".", "\\.")}(\\s|$)`).test(l));
  if (start < 0) return null;
  const end = lines.findIndex((l, i) => i > start && l.startsWith("## "));
  return lines.slice(start + 1, end < 0 ? undefined : end).join("\n").trim();
}

const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
const fail = (message) => {
  console.error(message);
  process.exit(1);
};

const args = process.argv.slice(2);
const notesOnly = args[0] === "--notes";
const version = (notesOnly ? args[1] : args[0])?.replace(/^v/, "");
if (!version || !/^\d+\.\d+\.\d+$/.test(version)) fail("Usage: npm run release -- <major.minor.patch>");

const notes = releaseNotes(readFileSync(`${root}/CHANGELOG.md`, "utf8"), version);
if (notesOnly) {
  if (notes === null) fail(`CHANGELOG.md has no "## ${version}" section`);
  console.log(notes);
  process.exit(0);
}

if (!notes) fail(`Write the notes first: CHANGELOG.md needs a "## ${version}" section with text`);
if (git("status", "--porcelain", "--untracked-files=no")) fail("Commit or stash your changes first: the release commit holds only the version");
if (git("tag", "--list", `v${version}`)) fail(`v${version} is already tagged`);

execFileSync("npm", ["version", version, "--no-git-tag-version", "--allow-same-version"], { cwd: app, stdio: "inherit", shell: process.platform === "win32" });

const cargoToml = `${app}/src-tauri/Cargo.toml`;
writeFileSync(cargoToml, readFileSync(cargoToml, "utf8").replace(/^version = ".*"$/m, `version = "${version}"`));
const cargoLock = `${app}/src-tauri/Cargo.lock`;
writeFileSync(cargoLock, readFileSync(cargoLock, "utf8").replace(/(name = "maddox"\r?\nversion = )".*"/, `$1"${version}"`));

git("add", "app/package.json", "app/package-lock.json", "app/src-tauri/Cargo.toml", "app/src-tauri/Cargo.lock");
// --allow-empty: the first release keeps the version already written.
git("commit", "--allow-empty", "-m", `Release ${version}`);
git("tag", "-a", `v${version}`, "-m", `Maddox ${version}`);
console.log(`\nTagged v${version}. To build the draft release:\n  git push origin main v${version}`);
