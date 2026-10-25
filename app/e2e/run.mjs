// Drives the app through the keyboard and checks results, one scenario at a
// time, each on a fresh page (scenarios/*.mjs; shared helpers in lib.mjs).
//   npm run e2e                     every scenario (needs `npm run dev` on :1420)
//   npm run e2e -- graphs settings  only those
//   npm run e2e -- --shots <dir>    a screenshot at the end of each scenario
// Uses an installed Edge or Chrome (or BROWSER_PATH); HEADED=1 shows it.
// Desktop app on Windows: start the built exe with
//   WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9333
//   then run with MADDOX_CDP=http://127.0.0.1:9333 (its one window is
//   cleared and reloaded between scenarios).
import { connect, helpers } from "./lib.mjs";

// The order they run in; each is independent of the others.
const SCENARIOS = ["basics", "templates", "layout", "files", "angles", "answers", "settings", "notation", "recalc", "graphs", "updates"];

const args = process.argv.slice(2);
const shotAt = args.indexOf("--shots");
const shotDir = shotAt >= 0 ? args.splice(shotAt, 2)[1] : null;
const unknown = args.filter((a) => !SCENARIOS.includes(a));
if (unknown.length) {
  console.error(`Unknown scenario: ${unknown.join(", ")}. Scenarios: ${SCENARIOS.join(", ")}`);
  process.exit(2);
}
const chosen = args.length ? SCENARIOS.filter((s) => args.includes(s)) : SCENARIOS;

const app = await connect();
const summary = [];
const started = Date.now();

for (const name of chosen) {
  const t0 = Date.now();
  let ok = 0;
  let failed = 0;
  console.log(`\n── ${name}`);
  const check = (label, pass, detail = "") => {
    console.log(`${pass ? "ok  " : "FAIL"} ${label}${pass ? "" : `  ${detail}`}`);
    if (pass) ok++;
    else failed++;
  };
  const { page, close } = await app.newPage();
  const errors = [];
  const onError = (e) => errors.push(String(e));
  const onConsole = (m) => m.type() === "error" && errors.push(m.text());
  page.on("pageerror", onError);
  page.on("console", onConsole);
  try {
    const h = helpers(page);
    await h.waitIdle();
    const { default: scenario } = await import(`./scenarios/${name}.mjs`);
    await scenario({ page, check, ...h });
    check("no page errors", errors.length === 0, errors.join("\n"));
  } catch (err) {
    // One scenario stopping doesn't stop the others.
    check(`${name} stopped early`, false, err instanceof Error ? err.stack ?? err.message : String(err));
  }
  if (shotDir) await page.screenshot({ path: `${shotDir}/${name}.png` }).catch(() => {});
  page.off("pageerror", onError);
  page.off("console", onConsole);
  await close();
  summary.push({ name, ok, failed, seconds: (Date.now() - t0) / 1000 });
}

await app.browser.close();

const total = summary.reduce((s, x) => ({ ok: s.ok + x.ok, failed: s.failed + x.failed }), { ok: 0, failed: 0 });
console.log("");
for (const s of summary) {
  console.log(`${s.name.padEnd(10)} ${String(s.ok).padStart(3)} ok${s.failed ? `  ${s.failed} FAILED` : ""}`.padEnd(32) + `${s.seconds.toFixed(1)} s`);
}
const failedNames = summary.filter((s) => s.failed).map((s) => s.name);
const time = `${((Date.now() - started) / 1000).toFixed(0)} s`;
console.log(failedNames.length ? `\n${total.failed} failed (${failedNames.join(", ")}), ${total.ok} ok, in ${time}` : `\nall passed: ${total.ok} checks in ${time}`);
process.exit(total.failed ? 1 : 0);
