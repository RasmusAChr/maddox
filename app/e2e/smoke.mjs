// Drives the app through the keyboard and checks results.
// Browser: start `npm run dev`, then `node e2e/smoke.mjs [screenshot-dir]`
//   (uses an installed Edge or Chrome; no browser download needed).
// Desktop app on Windows: start the built exe with
//   WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9333
//   then run with MADDOX_CDP=http://127.0.0.1:9333.
import { chromium } from "playwright-core";
import { existsSync } from "node:fs";

const URL = process.env.MADDOX_URL ?? "http://localhost:1420/";
const shotDir = process.argv[2];

const candidates = [
  process.env.BROWSER_PATH,
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/usr/bin/microsoft-edge",
].filter(Boolean);
const cdp = process.env.MADDOX_CDP;
const executablePath = candidates.find((p) => existsSync(p));
if (!cdp && !executablePath) throw new Error("No Chromium-based browser found; set BROWSER_PATH");

const browser = cdp
  ? await chromium.connectOverCDP(cdp)
  : await chromium.launch({ executablePath, headless: !process.env.HEADED });
const page = cdp ? browser.contexts()[0].pages()[0] : await browser.newPage({ viewport: { width: 1200, height: 800 } });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : `  ${detail}`}`);
  if (!ok) failures++;
};

const entries = () => page.$$eval("math-field", (fields) => fields.map((f) => f.value));
const resultOf = (i) =>
  page.$eval(`.entry:nth-child(${i + 1}) .entry-result`, (r) => ({
    exact: r.querySelector(".exact")?.dataset.latex ?? null,
    approx: !!r.querySelector(".approx"),
    error: r.querySelector(".error")?.textContent ?? null,
  }));
const waitIdle = () => page.waitForSelector('#engine-status[data-status="ready"]', { timeout: 60_000 });
const hints = () => page.textContent("#hints");

if (!cdp) await page.goto(URL);
await page.evaluate(() => localStorage.clear());
await page.reload();
const t0 = Date.now();
await waitIdle();
console.log(`engine ready in ${Date.now() - t0} ms`);

// 1. Plain arithmetic: exact result plus decimal.
// "/" builds a fraction and leaves the caret in the denominator; → leaves it.
await page.keyboard.type("1/3");
await page.keyboard.press("ArrowRight");
await page.keyboard.type("+1/6");
await page.keyboard.press("Enter");
await waitIdle();
let r = await resultOf(0);
check("fraction arithmetic", r.exact === "\\frac{1}{2}" && r.approx, JSON.stringify(r));
check("Enter opens a new entry", (await entries()).length === 2, JSON.stringify(await entries()));

// 2. Matrix via Ctrl+M, filled with Tab, grown and shrunk with Alt+arrows.
await page.keyboard.press("Control+m");
await page.waitForSelector("#matrix-dialog[open]");
await page.keyboard.type("2");
await page.keyboard.press("Tab");
await page.keyboard.type("2");
await page.keyboard.press("Enter");
for (const n of ["1", "2", "3", "4"]) {
  await page.keyboard.type(n);
  await page.keyboard.press("Tab");
}
let v = (await entries())[1];
check("matrix filled with Tab", /1&2\\\\3&4/.test(v.replace(/\s/g, "")), v);

// caret back into the matrix: go to the start, then right into the first cell
await page.keyboard.press("Home");
await page.keyboard.press("ArrowRight");
check("hint bar shows matrix keys", /Matrix 2×2/.test(await hints()), await hints());
await page.keyboard.press("Alt+ArrowDown");
check("Alt+Down adds a row", /Matrix 3×2/.test(await hints()), await hints());
await page.keyboard.press("Alt+ArrowRight");
check("Alt+Right adds a column", /Matrix 3×3/.test(await hints()), await hints());
await page.keyboard.press("Alt+Shift+ArrowRight");
await page.keyboard.press("Alt+Shift+ArrowDown");
check("Alt+Shift+arrows delete them again", /Matrix 2×2/.test(await hints()), await hints());
v = (await entries())[1];
check("matrix content survives", /1&2\\\\3&4/.test(v.replace(/\s/g, "")), v);
await page.keyboard.press("Alt+ArrowLeft"); // in a matrix: add column left
check("Alt+Left adds a column", /Matrix 2×3/.test(await hints()), await hints());
await page.keyboard.press("Alt+Shift+ArrowLeft");

// 3. Evaluate the matrix inverse.
await page.keyboard.press("End");
await page.keyboard.type("^-1");
await page.keyboard.press("Enter");
await waitIdle();
r = await resultOf(1);
check("matrix inverse", r.exact?.includes("\\frac{3}{2}") ?? false, JSON.stringify(r));

// 4. Variables, functions, ans (Enter above opened a fresh entry).
// A one-digit exponent is left automatically (MathLive's smartSuperscript).
await page.keyboard.type("f(x):=x^2+1");
await page.keyboard.press("Enter");
await page.keyboard.type("f(3)");
await page.keyboard.press("Enter");
await waitIdle();
const list = await entries();
r = await resultOf(list.length - 2);
check("user-defined function", r.exact === "10", JSON.stringify({ r, list }));

// 5. Search (Ctrl+K still works as an alias of Ctrl+P), insert solve.
await page.keyboard.press("Control+k");
await page.waitForSelector("#search-dialog[open]");
await page.keyboard.type("solve");
await page.keyboard.press("Enter");
await page.keyboard.type("x^2=2");
await page.keyboard.press("Enter");
await waitIdle();
const after = await entries();
r = await resultOf(after.length - 2);
check("search solve", r.exact?.includes("\\sqrt{2}") ?? false, JSON.stringify({ r, value: after[after.length - 2] }));

// 6. Errors are shown, not thrown.
await page.keyboard.type("1+");
await page.keyboard.press("Enter");
await waitIdle();
const n = (await entries()).length;
r = await resultOf(n - 2);
check("error message", !!r.error, JSON.stringify(r));

// 7. Backspace on an empty entry removes it.
await page.keyboard.press("Backspace");
await page.keyboard.press("Backspace");
check("Backspace removes an empty entry", (await entries()).length === n - 1, JSON.stringify(await entries()));

// 8. Esc cancels a long computation; the restarted engine keeps working.
await page.keyboard.press("Control+Enter");
// 2^256+1 written out; Giac needs ~15 s to factor it.
await page.keyboard.type("ifactor(115792089237316195423570985008687907853269984665640564039457584007913129639937");
await page.keyboard.press("Enter");
await page.waitForSelector('#engine-status[data-status="busy"]', { timeout: 5000 });
await page.waitForTimeout(500);
await page.keyboard.press("Escape");
await waitIdle();
const k = (await entries()).length;
r = await resultOf(k - 2);
check("Esc cancels", r.error === "Cancelled", JSON.stringify(r));
check("cancel explains the restart", /variables were cleared/.test(await page.textContent("#message")), await page.textContent("#message"));
await page.keyboard.type("6*7");
await page.keyboard.press("Enter");
await waitIdle();
r = await resultOf(k - 1);
check("engine works after cancel", r.exact === "42", JSON.stringify(r));

// 9. Shift+Enter starts a new line in the same entry; "#" at line start makes it text.
const before9 = (await entries()).length;
await page.keyboard.type("#");
await page.keyboard.type(" Area of the circle");
await page.keyboard.press("Shift+Enter");
await page.keyboard.type("r:=3");
await page.keyboard.press("Shift+Enter");
await page.keyboard.type("pi*r^2");
const cellIndex = before9 - 1;
let cell = (await entries())[cellIndex];
check("Shift+Enter keeps one entry", (await entries()).length === before9, JSON.stringify(await entries()));
check("# makes a text line", cell.includes("\\text{\\# Area of the circle}"), cell);
await page.keyboard.press("Enter");
await waitIdle();
const rows = await page.$$eval(`.entry:nth-child(${cellIndex + 1}) .result-line`, (els) =>
  els.map((el) => {
    const r = el.getBoundingClientRect();
    return { latex: el.querySelector(".exact") ? el.textContent : null, empty: el.childElementCount === 0, mid: (r.top + r.bottom) / 2 };
  }),
);
check("one result row per line", rows.length === 3, JSON.stringify(rows));
check("text line has no result", rows[0]?.empty === true, JSON.stringify(rows[0]));
check("every maths line evaluated", rows[1]?.latex?.includes("3") && rows[2]?.latex?.includes("9"), JSON.stringify(rows));
check("results sit beside their lines", rows[0]?.mid < rows[1]?.mid && rows[1]?.mid < rows[2]?.mid, JSON.stringify(rows));

// Shift+Enter inside a matrix ends the line instead of growing the matrix.
await page.keyboard.press("Control+m");
await page.waitForSelector("#matrix-dialog[open]");
await page.keyboard.press("Enter");
for (const n of ["1", "2", "3", "4"]) {
  await page.keyboard.type(n);
  await page.keyboard.press("Tab");
}
await page.keyboard.press("Home");
await page.keyboard.press("ArrowRight");
await page.keyboard.press("Shift+Enter");
await page.keyboard.type("x");
const last = (await entries()).at(-1).replace(/\s/g, "");
check("Shift+Enter in a matrix starts a new line", /1&2\\\\3&4\\end\{pmatrix\}\\\\x/.test(last), last);
await page.waitForTimeout(600);
const saved = await page.evaluate(() => localStorage.getItem("maddox.session"));
check("multi-line entry is saved", saved?.includes("Area of the circle") ?? false, saved?.slice(0, 200));

// 10. Every empty matrix cell shows a box: new columns get them, and a cell
// emptied with Backspace gets its box back (the box itself can't be deleted).
await page.keyboard.press("Control+Enter");
const current = async () => page.evaluate(() => document.activeElement?.value ?? "");
const countBoxes = async () => (await current()).split("\\placeholder").length - 1;
await page.keyboard.press("Control+m");
await page.waitForSelector("#matrix-dialog[open]");
await page.keyboard.press("Enter");
for (const n of ["1", "2", "3", "4"]) {
  await page.keyboard.type(n);
  await page.keyboard.press("Tab");
}
await page.keyboard.press("Home");
await page.keyboard.press("ArrowRight");
await page.keyboard.press("Alt+ArrowRight");
check("new column has boxes", (await countBoxes()) === 2, await current());
await page.keyboard.press("Alt+ArrowDown");
check("new row has boxes", (await countBoxes()) === 5, await current());
await page.keyboard.press("Control+Enter");
await page.keyboard.press("Control+m");
await page.waitForSelector("#matrix-dialog[open]");
await page.keyboard.press("Enter");
await page.keyboard.type("5");
await page.keyboard.press("Backspace");
await page.waitForTimeout(50);
check("emptied cell gets its box back", (await countBoxes()) === 4, await current());
await page.keyboard.press("Backspace");
await page.keyboard.press("Backspace");
await page.waitForTimeout(50);
check("a box cannot be deleted", (await countBoxes()) === 4 && /pmatrix/.test(await current()), await current());
await page.keyboard.type("7");
check("typing replaces the box", (await countBoxes()) === 3 && (await current()).includes("7"), await current());


// 11. Template sidebar: starts collapsed to an icon rail; Ctrl+B opens it;
// each category shows its everyday templates with the rest behind "More".
check("sidebar starts collapsed", await page.$eval("#templates", (el) => el.classList.contains("collapsed")));
check("collapsed strip has a single button", (await page.$$("#templates .templates-rail button")).length === 1);
await page.keyboard.press("Control+b");
check("Ctrl+B opens the sidebar", await page.isVisible("#templates .templates-list"));
await page.keyboard.press("Escape"); // back to the entry; the clicks below keep focus there
const visibleTemplates = async () => page.$$eval("#templates .template", (els) => els.filter((e) => e.offsetParent).map((e) => e.querySelector(".template-name").textContent));
let names = await visibleTemplates();
check("advanced templates are tucked away", names.includes("Derivative") && !names.includes("Taylor series"), JSON.stringify(names));
await page.click('#templates .tcat[data-id="calculus"] .tcat-more');
names = await visibleTemplates();
check("More reveals them", names.includes("Taylor series"), JSON.stringify(names));
await page.click('#templates .tcat[data-id="solve"] .tcat-head');
names = await visibleTemplates();
check("a category collapses", !names.includes("Solve a system"), JSON.stringify(names));
await page.click('#templates .tcat[data-id="solve"] .tcat-head');
await page.keyboard.press("Control+Enter");
await page.click('#templates .template:has(.template-name:text-is("Solve a system"))');
await page.keyboard.type("x+y=3");
await page.keyboard.press("Tab");
await page.keyboard.type("x-y=1");
await page.keyboard.press("Enter");
await waitIdle();
const sys = await page.$$eval(".entry .exact", (els) => els.map((e) => e.dataset.latex));
check("clicking a template inserts it", sys.includes("\\begin{pmatrix}2 & 1\\end{pmatrix}"), JSON.stringify(sys.slice(-3)));
await page.click("#templates .templates-collapse");
check("« collapses it again", await page.$eval("#templates", (el) => el.classList.contains("collapsed")));

// 12. Ctrl+P searches templates and app actions; all query words must match.
const searchFor = async (q) => {
  await page.keyboard.press("Control+p");
  await page.waitForSelector("#search-dialog[open]");
  await page.keyboard.type(q);
  const first = await page.$eval('#search-dialog .catalog-item[aria-selected="true"] .catalog-name', (e) => e.textContent);
  return first;
};
check("search 'derivative'", (await searchFor("derivative")) === "Derivative");
await page.keyboard.press("Escape");
check("search 'def int'", (await searchFor("def int")) === "Definite integral");
await page.keyboard.press("Escape");
check("search finds app actions", (await searchFor("save as")) === "Save as…");
await page.keyboard.press("Escape");
check("search by command name", (await searchFor("eigenvals")) === "Eigenvalues");
await page.keyboard.press("Enter");
const inserted = (await entries()).at(-1);
check("Enter inserts the result", inserted.includes("eigenvals"), inserted);

// 13. The sidebar's own search field filters templates; Enter inserts the best match.
await page.keyboard.press("Control+Enter");
await page.keyboard.press("Control+b");
await page.click("#templates .templates-search input");
await page.keyboard.type("taylor");
names = await visibleTemplates();
check("sidebar search filters", names.length === 1 && names[0] === "Taylor series", JSON.stringify(names));
await page.keyboard.press("Enter");
check("Enter inserts the match into the entry", (await entries()).at(-1).includes("taylor"), (await entries()).at(-1));
names = await visibleTemplates();
check("filter clears after inserting", names.length > 5, JSON.stringify(names));
await page.keyboard.press("Control+b");

// 14. Deleting at the edge of brackets removes the whole call, never half of it.
const field = () => page.evaluate(() => document.activeElement.value);
const prepare = async (typed, left = 0) => {
  await page.evaluate(() => { const f = document.activeElement; f.value = "2+"; f.executeCommand("moveToMathfieldEnd"); });
  await page.keyboard.type(typed);
  for (let i = 0; i < left; i++) await page.keyboard.press("ArrowLeft");
};
await page.keyboard.press("Control+Enter");
for (const key of ["Backspace", "Delete", "Control+Backspace", "Control+Delete"]) {
  await prepare("solve(");
  await page.keyboard.press(key);
  check(`empty solve() + ${key} deletes it`, (await field()) === "2+", await field());
}
await prepare("sin(x", 1);
await page.keyboard.press("Backspace");
check("Backspace at start of sin(x) keeps it, selected", (await field()).includes("\\sin\\left(x\\right)"), await field());
await page.keyboard.press("Backspace");
check("second Backspace deletes sin(x)", (await field()) === "2+", await field());
await prepare("sin(x", 1);
await page.keyboard.press("Control+Backspace");
check("Ctrl+Backspace at start of sin(x) deletes it", (await field()) === "2+", await field());
await prepare("sin(x");
await page.keyboard.press("Control+Delete");
check("Ctrl+Delete at end of sin(x) deletes it", (await field()) === "2+", await field());

// 15. Templates without the mouse: Ctrl+B focuses the search field, ↑/↓
// move the highlighted selection, Enter inserts, Esc goes back.
await page.keyboard.press("Control+Enter");
const active = () => page.evaluate(() => document.activeElement?.tagName + "." + document.activeElement?.className);
const selectedName = () => page.$eval("#templates .selected", (el) => el.querySelector(".template-name")?.textContent ?? el.textContent).catch(() => null);
await page.keyboard.press("Control+b");
check("Ctrl+B focuses the template search", (await active()).startsWith("INPUT"), await active());
await page.keyboard.press("ArrowDown");
check("↓ selects the first template", (await selectedName()) === "Fraction", await selectedName());
await page.keyboard.press("ArrowDown");
await page.keyboard.press("ArrowDown");
check("↓↓ moves the selection", (await selectedName()) === "Square root", await selectedName());
await page.keyboard.press("ArrowUp");
check("↑ moves it back", (await selectedName()) === "Power", await selectedName());
await page.keyboard.press("ArrowDown");
await page.keyboard.press("Enter");
check("Enter inserts the selected template", (await entries()).at(-1).includes("\\sqrt"), (await entries()).at(-1));
check("focus is back in the entry", (await active()).startsWith("MATH-FIELD"), await active());
await page.keyboard.press("Control+b"); // close
await page.keyboard.press("Control+b"); // open again
await page.keyboard.type("deriv");
check("typing selects the best match", (await selectedName()) === "Derivative", await selectedName());
await page.keyboard.press("ArrowDown");
// Integral matches too ("Antiderivative"), and sits right below.
check("↓ moves through the matches", (await selectedName()) === "Integral", await selectedName());
await page.keyboard.press("Escape");
check("Esc returns to the entry", (await active()).startsWith("MATH-FIELD"), await active());
check("Esc clears the filter", (await page.$eval("#templates .templates-search input", (i) => i.value)) === "");
await page.keyboard.press("Control+b"); // close (focus is in the entry)
await page.keyboard.press("Control+b"); // open
await page.keyboard.press("ArrowUp");
check("↑ from the field selects the last item", (await page.$eval("#templates .selected", (el) => el.classList.contains("tcat-more"))) === true);
await page.keyboard.press("Enter");
check("Enter on More expands it", await page.$eval('#templates .tcat[data-id="functions"]', (el) => el.classList.contains("show-more")));
await page.keyboard.press("Control+b");
check("Ctrl+B in the field closes and returns to the entry", (await active()).startsWith("MATH-FIELD") && (await page.$eval("#templates", (el) => el.classList.contains("collapsed"))), await active());

// 16. Clicking empty space never strands the keyboard.
const where = () => page.evaluate(() => {
  const a = document.activeElement;
  const entries = [...document.querySelectorAll(".entry")];
  return { tag: a?.tagName, index: entries.indexOf(a?.closest(".entry")) };
});
const nb = await page.$eval("#notebook", (el) => { const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, bottom: r.bottom }; });
await page.mouse.click(nb.x, nb.bottom - 20); // empty space below the last entry
let at = await where();
const count = (await entries()).length;
check("click below the entries focuses the last one", at.tag === "MATH-FIELD" && at.index === count - 1, JSON.stringify(at));
await page.keyboard.type("1+1");
check("and typing goes there", (await entries()).at(-1).endsWith("1+1"), (await entries()).at(-1));
const box = await page.$eval(".entry:nth-child(2)", (el) => { el.scrollIntoView({ block: "center" }); const r = el.getBoundingClientRect(); return { x: r.right - 8, y: r.top + 4 }; });
await page.mouse.click(box.x, box.y); // padding of the second entry
at = await where();
check("click on an entry's empty area focuses it", at.tag === "MATH-FIELD" && at.index === 1, JSON.stringify(at));
const bar = await page.$eval(".statusbar", (el) => { const r = el.getBoundingClientRect(); return { x: r.right - 40, y: r.top + r.height / 2 }; });
await page.mouse.click(bar.x, bar.y); // empty part of the status bar
at = await where();
check("click on the status bar keeps focus", at.tag === "MATH-FIELD" && at.index === 1, JSON.stringify(at));
await page.keyboard.press("Control+b");
const side = await page.$eval("#templates .templates-list", (el) => { const r = el.getBoundingClientRect(); return { x: r.left + 20, y: r.bottom - 5 }; });
await page.mouse.click(side.x, side.y); // empty sidebar space
at = await where();
check("click on empty sidebar space keeps the search field", at.tag === "INPUT", JSON.stringify(at));
await page.keyboard.press("ArrowDown");
check("so ↓ still selects", (await page.$$("#templates .selected")).length === 1);
await page.keyboard.press("Control+b");

if (shotDir) await page.screenshot({ path: `${shotDir}/maddox.png` });
check("no page errors", errors.length === 0, errors.join("\n"));

await browser.close();
console.log(failures ? `${failures} failed` : "all passed");
process.exit(failures ? 1 : 0);
