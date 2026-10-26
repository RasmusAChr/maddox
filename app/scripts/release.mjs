// Prepares a release: `npm run release -- 0.2.0`
//   Checks that the working tree is clean, that the tag is new, and that
//   CHANGELOG.md (repo root) has a "## 0.2.0" section; writes the version
//   into package.json (+ lock) and Cargo.toml (+ lock); commits "Release
//   0.2.0" and tags v0.2.0. It does not push: `git push origin main v0.2.0`
//   starts .github/workflows/release.yml, which builds a draft GitHub Release.
// `node scripts/release.mjs --notes 0.2.0` prints that release's notes: every
// CHANGELOG.md section after the previous release's tag, up to 0.2.0 (each
// fix or feature has its own section), with each "### New", "### Improved"
// and "### Fixed" heading once and "### Behind the scenes" left out. The
// workflow uses them for the release text and the in-app update dialog; it
// needs the tags fetched.
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const app = fileURLToPath(new URL("..", import.meta.url));
const root = fileURLToPath(new URL("../..", import.meta.url));
const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();

/** Compares "1.2.3" versions: negative, zero or positive. */
const compare = (a, b) => {
  const [x, y] = [a, b].map((v) => v.split(".").map(Number));
  return x[0] - y[0] || x[1] - y[1] || x[2] - y[2];
};

/** CHANGELOG.md's "## 1.2.3" sections, newest first: {version, text}. */
function sections(changelog) {
  const found = [];
  for (const line of changelog.split(/\r?\n/)) {
    const heading = /^## (\d+\.\d+\.\d+)\b/.exec(line);
    if (heading) found.push({ version: heading[1], lines: [] });
    else if (line.startsWith("## ")) found.push({ version: null, lines: [] });
    else found.at(-1)?.lines.push(line);
  }
  return found.filter((s) => s.version).map((s) => ({ version: s.version, text: s.lines.join("\n").trim() }));
}

/**
 * The notes for releasing `version`: its own section and every one since
 * the previous release (the newest tag below it), newest first. Null when
 * the version has no section.
 */
function releaseNotes(changelog, version) {
  const all = sections(changelog);
  if (!all.some((s) => s.version === version)) return null;
  const previous = git("tag", "--list", "v*")
    .split("\n")
    .map((t) => t.trim().replace(/^v/, ""))
    .filter((v) => /^\d+\.\d+\.\d+$/.test(v) && compare(v, version) < 0)
    .sort(compare)
    .at(-1);
  const included = all.filter((s) => compare(s.version, version) <= 0 && (!previous || compare(s.version, previous) > 0));
  return mergeHeadings(included.map((s) => s.text));
}

const headings = ["New", "Improved", "Fixed"];
const hidden = ["Behind the scenes"];

/**
 * Joins sections' texts under one "### New", "### Improved" and "### Fixed"
 * each (in that order, newest bullets first, as one list), dropping
 * "### Behind the scenes". Text before a section's first heading goes first.
 */
function mergeHeadings(texts) {
  const parts = new Map([["", []], ...[...headings, ...hidden].map((h) => [h, []])]);
  for (const text of texts) {
    let current = "";
    for (const line of text.split("\n")) {
      const heading = /^### (.+?)\s*$/.exec(line);
      if (heading) {
        current = heading[1];
        if (!parts.has(current)) fail(`CHANGELOG.md: unknown heading "### ${current}" (use ${[...headings, ...hidden].join(", ")})`);
      } else if (line.trim() || !current) parts.get(current).push(line);
    }
    parts.get("").push("");
  }
  const body = (lines) => lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  return [body(parts.get("")), ...headings.map((h) => body(parts.get(h)) && `### ${h}\n\n${body(parts.get(h))}`)]
    .filter(Boolean)
    .join("\n\n");
}

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
