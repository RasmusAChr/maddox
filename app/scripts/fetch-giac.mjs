// Downloads the Giac CAS (compiled to WebAssembly by its author, Bernard
// Parisse) into public/giac/. The file is ~19 MB, so it is not committed.
// The hash pins the exact build we tested against: if upstream republishes,
// this fails loudly instead of silently shipping a different engine. Review
// the new build, then update EXPECTED_SHA256 (and upload it as a new mirror
// release, see docs/releasing.md).
//
// Our own copy (a GitHub pre-release of this repository) comes first, so
// builds don't depend on one university server; the upstream original is
// the fallback. Both must match the same hash.
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, copyFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SOURCES = [
  "https://github.com/RasmusAChr/maddox/releases/download/engine-giac-1.9.0/giacjs.tar.gz",
  "https://www-fourier.univ-grenoble-alpes.fr/~parisse/giacjs.tar.gz",
];
const EXPECTED_SHA256 = "a39869bb02000d0baaf8a24907a57552ab4b63f1944b53c222db8fba2840cb7c";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "public", "giac");
const target = join(outDir, "giacwasm.js");

const sha256 = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");

if (existsSync(target) && sha256(target) === EXPECTED_SHA256) {
  console.log("giac: already present");
  process.exit(0);
}

/** Downloads one source, extracts it and checks the hash; throws with the reason if anything is off. */
async function fetchFrom(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download failed (${res.status})`);
  const work = mkdtempSync(join(tmpdir(), "giac-"));
  try {
    const archive = join(work, "giacjs.tar.gz");
    writeFileSync(archive, Buffer.from(await res.arrayBuffer()));
    // Relative paths only: GNU tar reads "C:\..." as a remote host spec.
    const tar = spawnSync("tar", ["-xzf", "giacjs.tar.gz", "giacjs/giacwasm.js", "giacjs/LICENSE"], { cwd: work, stdio: "inherit" });
    if (tar.status !== 0) throw new Error("extracting the archive failed (is `tar` on PATH?)");
    const extracted = join(work, "giacjs", "giacwasm.js");
    const actual = sha256(extracted);
    if (actual !== EXPECTED_SHA256) {
      throw new Error(`unexpected build (sha256 ${actual}). Review it, then update EXPECTED_SHA256 in scripts/fetch-giac.mjs.`);
    }
    mkdirSync(outDir, { recursive: true });
    copyFileSync(extracted, target);
    copyFileSync(join(work, "giacjs", "LICENSE"), join(outDir, "LICENSE"));
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

const failures = [];
for (const url of SOURCES) {
  console.log(`giac: downloading ${url}`);
  try {
    await fetchFrom(url);
    console.log("giac: ok");
    process.exit(0);
  } catch (err) {
    failures.push(`${url}: ${err.message}`);
    console.log(`giac: ${err.message}; trying the next source`);
  }
}
throw new Error(`giac: no source worked:\n${failures.join("\n")}`);
