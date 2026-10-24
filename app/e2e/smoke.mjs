// Drives the app through the keyboard and checks results.
// Browser: start `npm run dev`, then `node e2e/smoke.mjs [screenshot-dir]`
//   (uses an installed Edge or Chrome; no browser download needed).
// Desktop app on Windows: start the built exe with
//   WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9333
//   then run with MADDOX_CDP=http://127.0.0.1:9333.
import { chromium } from "playwright-core";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";

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
check("clicking a template inserts it", sys.includes("x=2\\text{ and }y=1"), JSON.stringify(sys.slice(-3)));
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
check("Enter on More expands it", await page.$eval('#templates .tcat[data-id="units"]', (el) => el.classList.contains("show-more")));
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

// 17. Ctrl+←/→ jump like in a text editor and never get stuck at a group edge.
await page.keyboard.press("Control+Enter");
await page.keyboard.type("AT:=transpose(A");
// Mark the caret with a "?" and read the value back.
const caretAt = () => page.evaluate(() => {
  const f = document.activeElement;
  const p = f.position;
  f.insert("?");
  const v = f.value.replace(/\s/g, "");
  f.executeCommand("undo");
  f.position = p;
  return v;
});
await page.keyboard.press("End");
const leftStops = [];
for (let i = 0; i < 4; i++) {
  await page.keyboard.press("Control+ArrowLeft");
  leftStops.push(await caretAt());
}
check(
  "Ctrl+← jumps over (A), transpose, :=, AT",
  leftStops[0].includes("}?\\left(") && leftStops[1].includes("\\coloneq?\\operatorname") &&
    leftStops[2].startsWith("AT?\\coloneq") && leftStops[3].startsWith("?AT"),
  JSON.stringify(leftStops),
);
await page.keyboard.press("Control+ArrowRight");
await page.keyboard.press("Control+ArrowRight");
await page.keyboard.press("Control+ArrowRight");
check("Ctrl+→ goes back to before (A)", (await caretAt()).includes("}?\\left("), await caretAt());
await page.keyboard.press("ArrowRight"); // into the brackets
await page.keyboard.press("Control+ArrowRight");
await page.keyboard.press("Control+ArrowRight");
check("Ctrl+→ leaves the brackets at their edge", (await caretAt()).endsWith("\\right)?"), await caretAt());
await page.keyboard.press("Control+Shift+ArrowLeft");
check("Shift+Ctrl+← selects by the same jumps", await page.evaluate(() => document.activeElement.getValue(document.activeElement.selection, "latex").includes("\\left(A\\right)")));

// 18. A name before brackets multiplies unless it is a function.
await page.keyboard.press("Control+Enter");
await page.keyboard.type("expand(3x(4y+8z");
await page.keyboard.press("Enter");
await waitIdle();
const products = await page.$$eval(".entry .exact", (els) => els.map((e) => e.dataset.latex));
check("3x(4y+8z) multiplies", products.includes("12\\cdot x\\cdot y+24\\cdot x\\cdot z"), JSON.stringify(products.slice(-2)));

// 19. Results never scroll: tall ones grow the cell, too-wide ones wrap below
// the input, and only a result wider than the whole cell scrolls (on its own).
const setAndRun = async (latex) => {
  await page.keyboard.press("Control+Enter");
  await page.evaluate((l) => { document.activeElement.value = l; }, latex);
  await page.keyboard.press("Enter");
  await waitIdle();
  await page.waitForTimeout(100);
};
// Finds the cell by its content: new cells go below the current one, which
// may be anywhere in the notebook by now.
const layoutOf = (needle) => page.$$eval(".entry", (els, n) => {
  const el = els.find((e) => e.querySelector("math-field")?.value.includes(n));
  const r = el.querySelector(".entry-result");
  const cs = getComputedStyle(r);
  const rows = [...r.children];
  return {
    scrollContainer: cs.overflowX !== "visible" || cs.overflowY !== "visible",
    cellFits: el.getBoundingClientRect().bottom >= r.getBoundingClientRect().bottom,
    wide: rows.map((x) => x.classList.contains("wide")),
    wrapped: r.getBoundingClientRect().top >= el.querySelector("math-field").getBoundingClientRect().bottom - 1,
  };
}, needle);
await setAndRun(String.raw`M\coloneq\begin{pmatrix}1&2\\3&4\\5&6\end{pmatrix}`);
let lay = await layoutOf("M\\coloneq");
check("tall matrix result: no scrolling, cell grows", !lay.scrollContainer && lay.cellFits && !lay.wide[0] && !lay.wrapped, JSON.stringify(lay));
await setAndRun(String.raw`\operatorname{expand}\left(\left(a+b+c\right)^{6}\right)`);
lay = await layoutOf("a+b+c");
check("huge result: wraps below and scrolls on its own", lay.wrapped && lay.wide[0] === true, JSON.stringify(lay));
check("the page never scrolls sideways", await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));

// 20. Full-screen look: leader dots join inputs to results, # lines are
// headings, Ctrl+/-/0 zoom.
await setAndRun(String.raw`\frac13+\frac16`);
const leader = await page.$$eval(".entry", (els) => {
  const el = els.find((e) => e.querySelector("math-field")?.value.includes("frac13"));
  const l = el?.querySelector(".leader");
  if (!l) return null;
  const input = el.querySelector("math-field").getBoundingClientRect();
  const result = el.querySelector(".result-line .exact").getBoundingClientRect();
  const r = l.getBoundingClientRect();
  return { startsAfterInput: r.left > input.left, endsBeforeResult: r.right < result.left, width: r.width };
});
check("leader dots join input and result", leader?.startsAfterInput && leader.endsBeforeResult && leader.width > 32, JSON.stringify(leader));
check("# lines are styled as headings", await page.evaluate(() => {
  const mf = document.querySelector("math-field");
  return [...mf.shadowRoot.querySelectorAll("style")].some((s) => s.textContent.includes(".ML__text"));
}));
await page.keyboard.press("Control+=");
const zoomedIn = await page.evaluate(() => document.documentElement.style.zoom);
await page.keyboard.press("Control+-");
await page.keyboard.press("Control+-");
const zoomedOut = await page.evaluate(() => document.documentElement.style.zoom);
await page.keyboard.press("Control+0");
const reset = await page.evaluate(() => document.documentElement.style.zoom);
check("Ctrl+= / Ctrl+- / Ctrl+0 zoom", zoomedIn === "1.1" && zoomedOut === "0.9" && reset === "", JSON.stringify([zoomedIn, zoomedOut, reset]));
check("zoom is remembered", await page.evaluate(() => localStorage.getItem("maddox.zoom")) === "1");

// 21. Never lose work: New with unsaved changes asks first. Esc keeps
// everything, D discards, Enter saves (a download in the browser) and goes on.
const unsavedOpen = () => page.$eval("#unsaved-dialog", (d) => d.open);
const isDirty = () => page.$eval("#dirty", (d) => !d.hidden);
await page.keyboard.press("Control+Enter");
await page.keyboard.type("7*6");
check("typing marks the notebook unsaved", await isDirty());
const before = (await entries()).length;
await page.keyboard.press("Control+n");
check("New with unsaved changes asks first", await unsavedOpen());
check("the question names the notebook", (await page.textContent("#unsaved-dialog .unsaved-name")) === "Untitled");
await page.keyboard.press("Escape");
check("Esc cancels and keeps everything", !(await unsavedOpen()) && (await entries()).length === before && (await isDirty()), JSON.stringify(await entries()));
check("focus returns to the notebook", await page.evaluate(() => document.activeElement?.tagName === "MATH-FIELD"));
await page.keyboard.press("Control+n");
await page.keyboard.press("d");
check("D discards and starts a new notebook", !(await unsavedOpen()) && (await entries()).length === 1 && !(await isDirty()), JSON.stringify(await entries()));
await page.keyboard.type("1+1");
await page.keyboard.press("Control+n");
const download = page.waitForEvent("download", { timeout: 5000 }).catch(() => null);
await page.keyboard.press("Enter");
const savedFile = await download;
check("Enter saves first (a download in the browser)", savedFile !== null && savedFile.suggestedFilename() === "Untitled.maddox", `${savedFile?.suggestedFilename()} / message: ${await page.textContent("#message")}`);
await page.waitForTimeout(200);
check("then the new notebook opens", (await entries()).length === 1 && (await entries())[0] === "" && !(await isDirty()), JSON.stringify(await entries()));
await page.keyboard.press("Control+n");
check("New without unsaved changes doesn't ask", !(await unsavedOpen()));
await page.keyboard.press("Control+Shift+O");
check("Ctrl+Shift+O explains recent files are a desktop feature", /desktop app/.test(await page.textContent("#message")), await page.textContent("#message"));

// 22. After a dialog closes, typing goes on in the cell (reported bug: type
// "1+", Ctrl+P, Esc, and typing did nothing in the desktop window).
await page.keyboard.press("Control+Enter");
await page.keyboard.type("1+");
await page.keyboard.press("Control+p");
await page.waitForSelector("#search-dialog[open]");
await page.keyboard.press("Escape");
await page.waitForTimeout(100);
await page.keyboard.type("3");
const afterEsc = await page.evaluate(() => document.activeElement?.value);
check("typing continues after Ctrl+P, Esc", afterEsc === "1+3", JSON.stringify(afterEsc));
await page.keyboard.press("Control+p");
await page.waitForSelector("#search-dialog[open]");
await page.keyboard.type("Run all");
await page.keyboard.press("Enter");
await page.waitForTimeout(100);
check("an action that focuses nothing returns focus to the cell", await page.evaluate(() => document.activeElement?.tagName === "MATH-FIELD"));

// 23. Degrees / radians: a new notebook starts in degrees, Ctrl+Shift+A
// switches and re-runs everything, 30deg types 30° (always degrees), and
// the mode is saved in the notebook file.
const chip = () => page.textContent("#angle-chip");
const resultFor = (needle) => page.$$eval(".entry", (els, n) => {
  const el = els.find((e) => e.querySelector("math-field")?.value.includes(n));
  return el?.querySelector(".exact")?.dataset.latex ?? null;
}, needle);
check("a new notebook starts in degrees", (await chip()) === "DEG", await chip());
await setAndRun(String.raw`\cos\left(60\right)`);
check("cos(60) = 1/2 in degrees", (await resultFor("cos")) === "\\frac{1}{2}", await resultFor("cos"));
await page.keyboard.press("Control+Shift+A");
await page.waitForTimeout(150);
await waitIdle();
await page.waitForTimeout(150);
check("Ctrl+Shift+A switches to radians", (await chip()) === "RAD", await chip());
check("switching re-runs: cos(60) is no longer 1/2", (await resultFor("cos")) !== "\\frac{1}{2}", await resultFor("cos"));
await page.keyboard.press("Control+Enter");
await page.keyboard.type("sin(30deg");
await page.keyboard.press("Enter");
await waitIdle();
check("30deg becomes 30° and means degrees even in radian mode", (await resultFor("degree")) === "\\frac{1}{2}", JSON.stringify(await entries()));
await page.evaluate(() => {
  window.__statusTexts = [];
  const status = document.querySelector("#engine-status");
  new MutationObserver(() => window.__statusTexts.push(status.textContent)).observe(status, { childList: true, characterData: true, subtree: true });
});
await page.click("#angle-chip");
await page.waitForTimeout(150);
await waitIdle();
await page.waitForTimeout(400);
check("the chip switches back to degrees", (await chip()) === "DEG" && (await resultFor("cos")) === "\\frac{1}{2}", await chip());
const flashes = await page.evaluate(() => window.__statusTexts);
check("switching doesn't flash Computing… in the status bar", !flashes.some((s) => s.includes("Computing")), JSON.stringify(flashes));
check("switching shows no message", !/Angles in/.test(await page.textContent("#message")), await page.textContent("#message"));
check("focus stays in the cell after clicking the chip", await page.evaluate(() => document.activeElement?.tagName === "MATH-FIELD"));
// Esc-cancel restarts the engine, which starts in radians: the mode must come back.
await page.keyboard.press("Control+Enter");
await page.keyboard.type("ifactor(115792089237316195423570985008687907853269984665640564039457584007913129639937");
await page.keyboard.press("Enter");
await page.waitForSelector('#engine-status[data-status="busy"]', { timeout: 5000 });
await page.waitForTimeout(300);
await page.keyboard.press("Escape");
await waitIdle();
await setAndRun(String.raw`\tan\left(45\right)`);
check("degree mode survives an engine restart", (await resultFor("tan")) === "1", await resultFor("tan"));
const fileSave = page.waitForEvent("download", { timeout: 5000 }).catch(() => null);
await page.keyboard.press("Control+s");
const angleFile = await fileSave;
const text = angleFile ? await readFile(await angleFile.path(), "utf8") : "";
check("the notebook file records the angle mode", /"angle": "deg"/.test(text), text.slice(0, 120));

// 24. Readable answers: solve as equations (default) or sets (Ctrl+P option),
// six-digit decimals, and errors in plain words.
await setAndRun(String.raw`\operatorname{solve}\left(x^2-5x+6=0,x\right)`);
check("solve answers read x = 2 or x = 3", (await resultFor("x^2-5x")) === "x=2\\text{ or }x=3", await resultFor("x^2-5x"));
const searchRun = async (q) => {
  await page.keyboard.press("Control+p");
  await page.waitForSelector("#search-dialog[open]");
  await page.keyboard.type(q);
  await page.keyboard.press("Enter");
  await page.waitForTimeout(150);
  await waitIdle();
  await page.waitForTimeout(150);
};
await searchRun("solve answers as sets");
check("the option switches to sets and re-runs", (await resultFor("x^2-5x")) === "x\\in\\left\\{2,\\,3\\right\\}", await resultFor("x^2-5x"));
await searchRun("solve answers as equations");
check("and back to equations", (await resultFor("x^2-5x")) === "x=2\\text{ or }x=3", await resultFor("x^2-5x"));
await setAndRun(String.raw`9\pi`);
const approx = await page.$$eval(".entry", (els) => {
  const el = els.find((e) => e.querySelector("math-field")?.value === "9\\pi");
  return el?.querySelector(".approx")?.textContent ?? null;
});
check("decimals show six significant digits", approx?.includes("28.2743") && !approx.includes("28.27433"), approx);
await setAndRun(String.raw`\operatorname{inv}\left(\begin{pmatrix}1&2\\2&4\end{pmatrix}\right)`);
const invError = await page.$$eval(".entry", (els) => els.find((e) => e.querySelector("math-field")?.value.includes("inv"))?.querySelector(".error")?.textContent ?? null);
check("errors are in plain words", invError === "This matrix can't be inverted: its determinant is 0.", invError);

// 25. Settings (Ctrl+,): ↑/↓ choose, ←/→ change at once, Esc back to the cell.
const approxOf = (latex) =>
  page.$$eval(".entry", (els, latex) => els.find((e) => e.querySelector("math-field")?.value === latex)?.querySelector(".approx")?.textContent ?? null, latex);
const focusedSetting = () => page.evaluate(() => document.activeElement?.closest(".setting")?.dataset.id ?? null);
const openSettingsAt = async (id) => {
  await page.keyboard.press("Control+,");
  await page.waitForSelector("#settings-dialog[open]");
  for (let i = 0; i < 12 && (await focusedSetting()) !== id; i++) await page.keyboard.press("ArrowDown");
};
const settled = async () => {
  await page.waitForTimeout(150);
  await waitIdle();
  await page.waitForTimeout(150);
};
await setAndRun(String.raw`9\pi`);
await page.keyboard.press("Control+,");
await page.waitForSelector("#settings-dialog[open]");
check("Ctrl+, opens settings on the first setting", (await focusedSetting()) === "angle", await focusedSetting());
await openSettingsAt("digits");
await page.keyboard.press("ArrowRight");
await settled();
check("→ on digits gives 8 digits at once", (await approxOf("9\\pi"))?.includes("28.274334"), await approxOf("9\\pi"));
check("the dialog stays open while changing", await page.isVisible("#settings-dialog[open]"));
await page.keyboard.press("ArrowLeft");
await page.keyboard.press("ArrowUp");
await page.keyboard.press("ArrowUp");
check("↑ moves to the answers setting", (await focusedSetting()) === "answer-mode", await focusedSetting());
await page.keyboard.press("ArrowRight");
await settled();
check("Exact only hides the decimal", (await approxOf("9\\pi")) === null, await approxOf("9\\pi"));
await page.keyboard.press("ArrowLeft");
await settled();
check("Exact + decimal shows it again with 6 digits", (await approxOf("9\\pi"))?.includes("28.2743") && !(await approxOf("9\\pi")).includes("28.27433"), await approxOf("9\\pi"));
await openSettingsAt("theme");
await page.keyboard.press("ArrowRight");
check("Theme → Light sets the theme", (await page.evaluate(() => document.documentElement.dataset.theme)) === "light");
await page.keyboard.press("ArrowRight");
const darkBg = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--sheet").trim());
check("Theme → Dark switches the colours", darkBg === "#1c1d21", darkBg);
await page.keyboard.press("ArrowLeft");
await page.keyboard.press("ArrowLeft");
check("Theme → System follows the system again", (await page.evaluate(() => document.documentElement.dataset.theme)) === undefined);
await page.keyboard.press("Escape");
await page.waitForTimeout(150);
check("Esc closes settings back into the cell", !(await page.isVisible("#settings-dialog[open]")) && (await page.evaluate(() => document.activeElement?.tagName === "MATH-FIELD")));
await page.keyboard.type("5");
check("typing works after settings closed", (await page.evaluate(() => document.activeElement?.value)) === "5", await page.evaluate(() => document.activeElement?.value));
await page.keyboard.press("Backspace");
// Opened from Ctrl+P, Esc closes it too (it didn't in WebKitGTK; see openDialog).
await page.keyboard.press("Control+p");
await page.keyboard.type("settings");
await page.keyboard.press("Enter");
await page.waitForSelector("#settings-dialog[open]");
await page.keyboard.press("Escape");
await page.waitForTimeout(150);
check("Ctrl+P Settings, then Esc, closes it back into the cell", !(await page.isVisible("dialog[open]")) && (await page.evaluate(() => document.activeElement?.tagName === "MATH-FIELD")));
await page.click('[data-action="settings"]');
await page.waitForSelector("#settings-dialog[open]");
check("the gear button opens settings", await page.isVisible("#settings-dialog[open]"));
await page.click('#settings-dialog [data-id="angle"] .seg button:last-child');
await settled();
check("clicking Radians changes the notebook's mode", (await chip()) === "RAD", await chip());
await page.click('#settings-dialog [data-id="angle"] .seg button:first-child');
await settled();
await page.keyboard.press("Escape");
const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("maddox.prefs") ?? "{}"));
check("settings are remembered", stored.digits === 6 && stored.answerMode === "auto" && stored.theme === "system", JSON.stringify(stored));
// Reopen last notebook: Off starts empty, but unsaved work is still restored.
await page.waitForTimeout(150);
await openSettingsAt("reopen");
await page.keyboard.press("ArrowRight");
await page.keyboard.press("Escape");
await page.waitForTimeout(150);
const cleanSave = page.waitForEvent("download", { timeout: 5000 }).catch(() => null);
await page.keyboard.press("Control+s");
await cleanSave;
await page.waitForTimeout(200);
await page.reload();
await page.waitForSelector("math-field");
await waitIdle();
const afterReload = await page.$$eval(".entry math-field", (els) => els.map((e) => e.value));
check("Reopen last: Off starts an empty notebook", afterReload.length === 1 && afterReload[0] === "", JSON.stringify(afterReload));
await page.waitForTimeout(300);
await page.keyboard.type("7*6");
await page.keyboard.press("Enter");
await waitIdle();
await page.waitForTimeout(700); // autosave waits 400 ms
await page.reload();
await page.waitForSelector("math-field");
const unsavedKept = await page.$$eval(".entry math-field", (els) => els.map((e) => e.value));
check("…but unsaved work is still restored", unsavedKept.some((v) => v.includes("7") && v.includes("6")), JSON.stringify(unsavedKept));
await page.evaluate(() => localStorage.removeItem("maddox.prefs"));

// 26. A notebook that fits has no scrollbar; a tall one gets room to scroll
// the last cell up off the bottom edge.
const scrollRoom = () => page.evaluate(() => {
  const nb = document.querySelector("#notebook");
  return nb.scrollHeight - nb.clientHeight;
});
check("a notebook that fits doesn't scroll", (await scrollRoom()) <= 0, await scrollRoom());
await page.evaluate(() =>
  localStorage.setItem("maddox.session", JSON.stringify({ entries: Array.from({ length: 40 }, (_, i) => `${i}+1`), path: null, dirty: true, angle: "deg" })),
);
await page.reload();
await page.waitForSelector("math-field");
await waitIdle();
const tallRoom = await page.evaluate(() => {
  const nb = document.querySelector("#notebook");
  const sheet = document.querySelector("#sheet");
  return nb.scrollHeight - (sheet.offsetTop + sheet.offsetHeight) - nb.clientHeight * 0.3;
});
check("a tall notebook can scroll its end up the screen", tallRoom > 0, tallRoom);

// 27. Points: (a, b) typed at the keyboard is a point, shown with round
// brackets, and computes like a vector; positions count from 1.
const typeAndRun = async (text) => {
  await page.keyboard.press("Control+Enter");
  await page.keyboard.type(text);
  await page.keyboard.press("Enter");
  await waitIdle();
  await page.waitForTimeout(100);
};
await typeAndRun("Pa:=(1,3");
check("a typed point shows as (1, 3)", (await resultFor("Pa\\coloneq")) === "\\left(1,\\,3\\right)", await resultFor("Pa\\coloneq"));
await typeAndRun("Qa:=(3,8");
await typeAndRun("Qa-Pa");
check("Q − P computes like a vector", (await resultFor("Qa-Pa")) === "\\left(2,\\,5\\right)", await resultFor("Qa-Pa"));
await typeAndRun("Qa[2");
check("Qa[2] is the second coordinate", (await resultFor("Qa\\left\\lbrack2")) === "8", await resultFor("Qa\\left\\lbrack2"));
await typeAndRun("(8,15");
const pointApprox = await page.$$eval(".entry", (els) => els.find((e) => e.querySelector("math-field")?.value === "\\left(8,15\\right)")?.querySelector(".approx")?.textContent ?? null);
check("a whole-number point has no stray decimal (not 8,15,6)", pointApprox === null, pointApprox);

// 28. Results of one multi-line cell keep a little air between them, even
// when they are taller than their lines (stacked matrices).
await setAndRun("\\displaylines{Ma\\coloneq\\begin{pmatrix}1&1\\\\1&3\\end{pmatrix}\\\\ Mb\\coloneq\\begin{pmatrix}3\\\\8\\end{pmatrix}\\\\ \\operatorname{transpose}(Ma)}");
const gaps = await page.$$eval(".entry", (els) => {
  const el = els.find((e) => e.querySelector("math-field")?.value.includes("Ma\\coloneq"));
  const boxes = [...el.querySelectorAll(".result-line .exact")].map((x) => x.getBoundingClientRect());
  return boxes.slice(1).map((b, i) => Math.round(b.top - boxes[i].bottom));
});
check("stacked results don't touch", gaps.length === 2 && gaps.every((g) => g >= 6), JSON.stringify(gaps));

// 29. Alt+Enter switches one cell to decimals (≈ marker, saved with the
// cell), and back to the answers setting.
await setAndRun("\\frac{7}{8}");
await page.keyboard.press("ArrowUp");
await page.keyboard.press("Alt+Enter");
await waitIdle();
await page.waitForTimeout(100);
const chipOf = (needle) => page.$$eval(".entry", (els, n) => {
  const el = els.find((e) => e.querySelector("math-field")?.value.includes(n));
  const c = el?.querySelector(".answers-chip");
  return c && !c.hidden ? c.textContent : null;
}, needle);
check("Alt+Enter shows the cell as decimals", (await resultFor("frac{7}{8}")) === "0.875", await resultFor("frac{7}{8}"));
check("the switched cell shows ≈", (await chipOf("frac{7}{8}")) === "≈", await chipOf("frac{7}{8}"));
check("Alt+Enter keeps the caret in the cell", (await current()).includes("frac{7}{8}"), await current());
await page.waitForTimeout(600);
const switched = await page.evaluate(() => localStorage.getItem("maddox.session"));
check("the switch is saved with the cell", /frac\{7\}\{8\}","answers":"approx"/.test(switched ?? ""), switched?.slice(-200));
await page.keyboard.press("Alt+Enter");
await waitIdle();
await page.waitForTimeout(100);
check("Alt+Enter again follows the setting", (await resultFor("frac{7}{8}")) !== "0.875" && (await chipOf("frac{7}{8}")) === null, await resultFor("frac{7}{8}"));

// 30. More notation, typed: f′(x) is a derivative, % is hundredths, a
// piecewise function comes from the template and is edited like a matrix.
await page.keyboard.press("Control+Enter");
await page.keyboard.type("fd(x");
await page.keyboard.press("ArrowRight");
await page.keyboard.type(":=x^3");
await page.keyboard.press("Enter");
await waitIdle();
await typeAndRun("fd'(2");
check("f′(2) is the derivative at 2", (await resultFor("fd^{\\prime}")) === "12", await resultFor("fd^{\\prime}"));
await typeAndRun("20%*150");
check("20% of 150 is 30", (await resultFor("20\\%")) === "30", await resultFor("20\\%"));
await page.keyboard.press("Control+Enter");
await page.keyboard.type("gp(x");
await page.keyboard.press("ArrowRight");
await page.keyboard.type(":=");
await searchRun("piecewise");
await page.keyboard.type("-x");
await page.keyboard.press("Tab");
await page.keyboard.type("x<0");
await page.keyboard.press("Tab");
await page.keyboard.type("x^2");
await page.keyboard.press("Tab");
await page.keyboard.type("otherwise");
check("the hints explain a piecewise function", /Piecewise, 2 cases/.test(await hints()), await hints());
await page.keyboard.press("Alt+ArrowDown");
check("Alt+↓ adds a case", /Piecewise, 3 cases/.test(await hints()), await hints());
await page.keyboard.press("Alt+Shift+ArrowDown");
check("Alt+Shift+↓ deletes it again", /Piecewise, 2 cases/.test(await hints()), await hints());
await page.keyboard.press("Enter");
await waitIdle();
await page.waitForTimeout(100);
const piecewise = await resultFor("gp\\left");
check("a piecewise function shows as a brace", piecewise?.includes("\\begin{cases}") && piecewise.includes("\\text{otherwise}"), piecewise);
await typeAndRun("gp(-3");
check("and evaluates by case", (await resultFor("gp\\left(-3")) === "3", await resultFor("gp\\left(-3"));
await setAndRun(String.raw`\operatorname{solve}\left(x^2<4,x\right)`);
check("an inequality answer reads -2 < x < 2", (await resultFor("x^2<4")) === "-2<x<2", await resultFor("x^2<4"));

// 31. Units: Ctrl+U types an upright unit (Space ends it), → converts, and
// italic letters stay variables.
const resultOfCurrent = () => page.evaluate(() => {
  const el = document.activeElement.closest(".entry").previousElementSibling;
  return el?.querySelector(".exact")?.dataset.latex ?? el?.querySelector(".error")?.textContent ?? null;
});
await page.keyboard.press("Control+Enter");
await page.keyboard.type("72");
await page.keyboard.press("Control+u");
check("Ctrl+U starts a unit", /Unit/.test(await hints()), await hints());
await page.keyboard.type("km/h");
await page.keyboard.press(" ");
check("Space ends the unit", !/Unit/.test(await hints()), await hints());
check("a unit is upright, / stays inline", (await current()).includes("72\\mathrm{km/h}"), await current());
await page.keyboard.type("->");
await page.keyboard.press("Control+u");
await page.keyboard.type("m/s");
await page.keyboard.press("Enter");
await waitIdle();
await page.waitForTimeout(100);
check("72 km/h → m/s is 20 m/s", (await resultOfCurrent()) === "20\\,\\mathrm{m}/\\mathrm{s}", await resultOfCurrent());
await page.keyboard.type("3");
await page.keyboard.press("Control+u");
await page.keyboard.type("kg");
await page.keyboard.press(" ");
await page.keyboard.type("*9.81");
await page.keyboard.press("Control+u");
await page.keyboard.type("m/s^2");
await page.keyboard.press("Enter");
await waitIdle();
await page.waitForTimeout(100);
check("3 kg · 9.81 m/s² is 29.43 N", (await resultOfCurrent()) === "29.43\\,\\mathrm{N}", await resultOfCurrent());
await page.keyboard.type("2");
await page.keyboard.press("Control+u");
await page.keyboard.type("kg*m");
await page.keyboard.press(" ");
await page.keyboard.type("x");
check("* is a · between units; letters after Space are variables", /^2\\mathrm\{kg\}\\cdot\\mathrm\{m\}x$/.test(await current()), await current());
await page.keyboard.press("Control+Backspace");
await page.keyboard.press("Control+a");
await page.keyboard.press("Backspace");
await page.keyboard.type("5");
await page.keyboard.press("Control+u");
await page.keyboard.type("xyz");
await page.keyboard.press("Enter");
await waitIdle();
await page.waitForTimeout(100);
check("an unknown unit is explained", (await resultOfCurrent()) === "Unknown unit: xyz", await resultOfCurrent());

// 32. Temperatures: ° inside unit mode makes °C / °F, → converts, and nothing
// else is allowed with them.
await page.keyboard.type("20");
await page.keyboard.press("Control+u");
await page.keyboard.type("°C");
await page.keyboard.press(" ");
await page.keyboard.type("->");
await page.keyboard.press("Control+u");
await page.keyboard.type("°F");
await page.keyboard.press("Enter");
await waitIdle();
await page.waitForTimeout(100);
check("20 °C → °F is 68 °F", (await resultOfCurrent()) === "68\\,^{\\circ}\\mathrm{F}", await resultOfCurrent());
await page.keyboard.type("20");
await page.keyboard.press("Control+u");
await page.keyboard.type("°C");
await page.keyboard.press(" ");
await page.keyboard.type("+5");
await page.keyboard.press("Control+u");
await page.keyboard.type("°C");
await page.keyboard.press("Enter");
await waitIdle();
await page.waitForTimeout(100);
check("20 °C + 5 °C is explained", /Temperatures can only be converted/.test(await resultOfCurrent()), await resultOfCurrent());

// 33. Changing a definition recalculates the cells below that use it (and
// what they define); unrelated cells are left alone. Deleting the
// definition clears the name.
const recalculated = (needle) => page.$$eval(".entry", (els, n) =>
  els.find((e) => e.querySelector("math-field")?.value.includes(n))?.classList.contains("recalculated") ?? null, needle);
await setAndRun(String.raw`rq\coloneq3`);
await setAndRun(String.raw`Aq\coloneq2\cdot rq`);
await setAndRun(String.raw`wq\coloneq7`);
await setAndRun(String.raw`Aq+1`);
check("Aq + 1 is 7 before the change", (await resultFor("Aq+1")) === "7", await resultFor("Aq+1"));
// Up to rq := 3 (setAndRun leaves empty cells in between).
for (let i = 0; i < 10 && (await current()) !== "rq\\coloneq3"; i++) {
  await page.keyboard.press("ArrowUp");
  await page.waitForTimeout(50);
}
check("↑ reaches rq := 3", (await current()) === "rq\\coloneq3", await current());
await page.evaluate(() => { document.activeElement.value = "rq\\coloneq4"; });
await page.keyboard.press("Enter");
await page.waitForTimeout(300);
await waitIdle();
await page.waitForTimeout(100);
check("Enter on rq := 4 recalculates Aq", (await resultFor("Aq\\coloneq")) === "8", await resultFor("Aq\\coloneq"));
check("and the cell that uses Aq", (await resultFor("Aq+1")) === "9", await resultFor("Aq+1"));
check("changed results are highlighted", (await recalculated("Aq+1")) === true);
check("an unrelated cell is not re-run", (await recalculated("wq\\coloneq")) === false);
await page.keyboard.press("ArrowUp"); // Enter moved on to Aq
check("back on rq := 4", (await current()) === "rq\\coloneq4", await current());
await page.keyboard.press("Control+Shift+Backspace");
await page.waitForTimeout(300);
await waitIdle();
await page.waitForTimeout(100);
check("deleting rq := 4 clears rq for the cells using it", /rq/.test((await resultFor("Aq\\coloneq")) ?? ""), await resultFor("Aq\\coloneq"));

// 32. Graphs: plot(…) draws below the cell; Alt+↓ goes in, ←/→ trace, + zooms
// (saved with the cell), 0 resets, Esc goes back.
await page.keyboard.press("Control+Enter");
await page.keyboard.type("fp(x");
await page.keyboard.press("ArrowRight");
await page.keyboard.type(":=x^2-2");
await page.keyboard.press("Shift+Enter");
await page.keyboard.type("plot(fp,x");
await page.waitForTimeout(100);
const plotCell = () => page.$$eval(".entry", (els) => {
  const el = els.find((e) => /plot\}+\\left\(/.test(e.querySelector("math-field")?.value ?? ""));
  return el ? { curves: [...el.querySelectorAll(".graph-curve")].filter((p) => (p.getAttribute("d") ?? "").length > 20).length, note: el.querySelector(".graph-note")?.textContent ?? null } : null;
});
check("typing plot( gives the plot command", /operatorname\{(\\mathrm\{)?plot\}/.test(await current()), await current());
await page.keyboard.press("ArrowUp"); // back to the first line, so Enter evaluates the whole cell
await page.keyboard.press("Enter");
await waitIdle();
await page.waitForTimeout(600);
check("plot draws both curves below the cell", (await plotCell())?.curves === 2, JSON.stringify(await plotCell()));
await page.keyboard.press("ArrowUp");
await page.keyboard.press("Alt+ArrowDown");
const inGraph = () => page.evaluate(() => document.activeElement?.classList.contains("graph") ?? false);
const readout = () => page.$eval(".graph:focus .graph-readout", (el) => el.textContent);
check("Alt+↓ moves into the graph", await inGraph(), await active());
check("the hints explain the graph keys", /Graph/.test(await hints()), await hints());
await page.keyboard.press("ArrowRight");
await page.waitForTimeout(200);
check("→ starts tracing at x = 0", /x = 0,\s+y = −2/.test(await readout()), await readout());
await page.keyboard.press("ArrowRight");
await page.waitForTimeout(200);
check("→ steps along the curve", /x = 0\.2,\s+y = −1\.96/.test(await readout()), await readout());
await page.keyboard.press("ArrowDown");
await page.waitForTimeout(200);
check("↓ switches to the next curve", /x = 0\.2,\s+y = 0\.2/.test(await readout()), await readout());
await page.keyboard.press("+");
await page.waitForTimeout(700);
const savedView = await page.evaluate(() => localStorage.getItem("maddox.session"));
check("a zoomed view is saved with the cell", /"views":\{"1":\{"xmin"/.test(savedView ?? ""), savedView?.slice(-300));
await page.keyboard.press("0");
await page.waitForTimeout(700);
const resetView = await page.evaluate(() => localStorage.getItem("maddox.session"));
check("0 resets to the automatic view", !/"views"/.test(resetView ?? ""), resetView?.slice(-300));
await page.keyboard.press("Escape");
check("Esc goes back to the cell", (await active()).startsWith("MATH-FIELD") && (await current()).includes("plot"), await active());

// 33. The graph panel (Ctrl+G): a list per tab above a graph, tabs by
// keyboard, F6 between notebook and panel, Ctrl+Shift+G from a cell line.
const panelState = () => page.evaluate(() => ({
  open: !document.querySelector("#graph-panel").hidden,
  focus: document.activeElement?.className ?? "",
  inPanel: document.querySelector("#graph-panel").contains(document.activeElement),
  rows: [...document.querySelectorAll(".panel-input")].map((m) => m.value),
  tabs: [...document.querySelectorAll(".panel-tab")].map((t) => (t.getAttribute("aria-selected") === "true" ? "*" : "") + t.firstChild.textContent),
  curves: [...document.querySelectorAll(".graph-panel .graph-curve")].filter((p) => (p.getAttribute("d") ?? "").length > 20).length,
}));
await page.keyboard.press("Control+g");
await page.waitForTimeout(200);
let ps = await panelState();
check("Ctrl+G opens the panel with the keyboard in its list", ps.open && ps.focus.includes("panel-input"), JSON.stringify(ps));
await page.keyboard.type("fp");
await page.keyboard.press("Enter");
await page.keyboard.type("x");
await page.waitForTimeout(1200);
ps = await panelState();
check("each row of the list is drawn", ps.curves === 2 && ps.rows.join("|") === "fp|x", JSON.stringify(ps));
await page.keyboard.press("Enter");
await page.keyboard.type("fp(5");
await page.waitForTimeout(1200);
const rowValue = await page.$$eval(".panel-row.has-value .panel-value", (els) => els.map((e) => e.textContent));
const panelDots = () => page.$$eval(".graph-panel .graph-point", (els) => els.map((e) => [e.getAttribute("cx"), e.getAttribute("cy")]));
check("f(5) in a row shows = 23 and marks its point", rowValue.length === 1 && /=\s*23/.test(rowValue[0]) && (await panelState()).curves === 2 && (await panelDots()).length === 1, JSON.stringify([rowValue, await panelDots()]));
await page.keyboard.press("Control+a");
await page.keyboard.press("Backspace");
await page.keyboard.press("Backspace"); // the now empty row goes
await page.waitForTimeout(300);
await page.keyboard.press("ArrowDown");
check("↓ from the last row goes into the graph", (await page.evaluate(() => document.activeElement?.classList.contains("graph"))) === true, (await panelState()).focus);
await page.keyboard.press("Escape");
check("Esc in the graph goes back to the list", (await panelState()).focus.includes("panel-input"), (await panelState()).focus);
await page.keyboard.press("Control+Enter");
await page.waitForTimeout(200);
ps = await panelState();
check("Ctrl+Enter makes a new tab", ps.tabs.join("|") === "Graph 1|*Graph 2" && ps.rows.join("|") === "", JSON.stringify(ps));
await page.keyboard.press("Control+PageUp");
await page.waitForTimeout(200);
ps = await panelState();
check("Ctrl+PageUp goes back to the first tab and its list", ps.tabs[0] === "*Graph 1" && ps.rows.join("|") === "fp|x", JSON.stringify(ps));
await page.keyboard.press("F2");
await page.keyboard.type("Parabola");
await page.keyboard.press("Enter");
ps = await panelState();
check("F2 renames the tab", ps.tabs[0] === "*Parabola" && ps.focus.includes("panel-input"), JSON.stringify(ps));
await page.keyboard.press("F6");
check("F6 goes to the notebook", !(await panelState()).inPanel && (await active()).startsWith("MATH-FIELD"), await active());
await page.keyboard.press("Control+Shift+g");
await page.waitForTimeout(800);
ps = await panelState();
check("Ctrl+Shift+G adds the line's items to the open tab", ps.rows.join("|") === "fp|x|fp|x" && !ps.inPanel, JSON.stringify(ps));
await page.keyboard.press("F6");
check("F6 goes back to the panel", (await panelState()).inPanel, (await panelState()).focus);
await page.waitForTimeout(600);
const savedPanel = await page.evaluate(() => JSON.parse(localStorage.getItem("maddox.session") ?? "{}").graphs);
check("the panel is saved: open, tabs, lists", savedPanel?.open === true && savedPanel.tabs?.[0]?.name === "Parabola" && savedPanel.tabs[1]?.name === "Graph 2", JSON.stringify(savedPanel));
// g(x) = … defines g for this tab only; := is for cells.
await page.keyboard.press("Control+Enter");
await page.keyboard.type("gl(x");
await page.keyboard.press("ArrowRight");
await page.keyboard.type("=2x+3");
await page.keyboard.press("Enter");
await page.keyboard.type("gl(0");
await page.keyboard.press("Enter");
await page.keyboard.type("hl(x");
await page.keyboard.press("ArrowRight");
await page.keyboard.type(":=x");
await page.waitForTimeout(1500);
const localRows = await page.$$eval(".panel-row", (rows) => rows.map((r) => ({ value: r.querySelector(".panel-value")?.textContent ?? "", error: r.querySelector(".panel-error")?.textContent ?? "" })));
ps = await panelState();
check("g(x) = … in a graph row is drawn and usable by other rows", ps.curves === 1 && /=\s*3/.test(localRows[1]?.value ?? ""), JSON.stringify([ps, localRows]));
check(":= in a graph row says to use = (or a cell)", /Use = to define hl in this graph/.test(localRows[2]?.error ?? ""), JSON.stringify(localRows[2]));
await page.keyboard.press("F6");
await page.keyboard.press("Control+Enter");
await page.keyboard.type("gl(1");
await page.keyboard.press("Enter");
await waitIdle();
await page.waitForTimeout(150);
check("the graph's own g is not defined in the notebook", (await resultFor("gl\\left(1")) !== "5", await resultFor("gl\\left(1"));
await page.keyboard.press("F6");
await page.keyboard.press("Control+g");
ps = await panelState();
check("Ctrl+G closes it and returns to the notebook", !ps.open && (await active()).startsWith("MATH-FIELD"), JSON.stringify(ps));

// 34. Points worth knowing: tracing a curve shows its zeros, max/min,
// y-intercept and intersections as dots; Tab jumps between them, named exactly.
await page.keyboard.press("Control+Enter");
await page.keyboard.type("plot(fp,x");
await page.keyboard.press("Enter");
await waitIdle();
await page.waitForTimeout(500);
await page.keyboard.press("ArrowUp");
await page.keyboard.press("Alt+ArrowDown");
await page.keyboard.press("ArrowRight"); // trace fp from x = 0
await page.waitForTimeout(1200);
const focusedGraph = () => page.evaluate(() => {
  const g = document.activeElement;
  return { dots: g?.querySelectorAll(".graph-feature").length ?? 0, readout: g?.querySelector(".graph-readout")?.textContent ?? "" };
});
let fg = await focusedGraph();
check("tracing a curve shows its points worth knowing", fg.dots === 6 && /Tab: zeros/.test(fg.readout), JSON.stringify(fg));
await page.keyboard.press("Tab");
fg = await focusedGraph();
check("Tab jumps to the next one: the zero √2", /Zero/.test(fg.readout) && /1\.41421/.test(fg.readout), fg.readout);
await page.keyboard.press("Tab");
fg = await focusedGraph();
check("…then the intersection with x at (2, 2)", /Intersection/.test(fg.readout) && /with/.test(fg.readout), fg.readout);
await page.keyboard.press("Shift+Tab");
fg = await focusedGraph();
check("Shift+Tab goes back", /Zero/.test(fg.readout), fg.readout);
check("Tab keeps the keyboard in the graph", await inGraph(), await active());
await page.keyboard.press("Escape");

// 35. Sliders: names without a value get one under an inline graph (S goes to
// it, ←/→ change it, saved with the cell); in the panel, Enter adds a = 1 rows
// whose sliders Alt+←/→ nudge.
await page.keyboard.press("Control+Enter");
await page.keyboard.type("plot(sa*x^2+sb");
await page.keyboard.press("Enter");
await waitIdle();
await page.waitForTimeout(600);
const sliderCell = () => page.$$eval(".entry", (els) => {
  const el = els.find((e) => /sa\*x\^2\+sb/.test(e.querySelector("math-field")?.value ?? ""));
  if (!el) return null;
  const graph = el.querySelector(".graph");
  return {
    names: [...el.querySelectorAll(".graph-slider-name")].map((n) => n.textContent),
    values: [...el.querySelectorAll(".graph-slider-value")].map((n) => n.textContent),
    curve: el.querySelector(".graph-curve")?.getAttribute("d")?.slice(0, 80) ?? "",
    fits: graph ? graph.getBoundingClientRect().right <= el.getBoundingClientRect().right + 1 : false,
  };
});
const inView = await page.evaluate(() => {
  const n = document.querySelector("#notebook").getBoundingClientRect();
  const a = document.activeElement.getBoundingClientRect();
  return a.top >= n.top && a.bottom <= n.bottom;
});
check("after Enter the caret's cell stays in view below the new graph", inView);
let sc = await sliderCell();
check("names without a value get sliders under the graph", sc?.names.join(",") === "sa,sb" && sc.values.join(",") === "1,1", JSON.stringify(sc));
check("the graph fits inside its cell", sc?.fits === true, JSON.stringify(sc));
const curveBefore = sc?.curve;
await page.keyboard.press("ArrowUp");
await page.keyboard.press("Alt+ArrowDown");
await page.keyboard.press("s");
check("S goes to the first slider", (await page.evaluate(() => document.activeElement?.getAttribute("aria-label"))) === "Slider for sa");
await page.keyboard.press("Shift+ArrowRight");
await page.waitForTimeout(700);
sc = await sliderCell();
check("Shift+→ moves the slider by 1 and the curve follows", sc?.values[0] === "2" && sc.curve !== curveBefore, JSON.stringify(sc));
const savedSliders = await page.evaluate(() => JSON.stringify(JSON.parse(localStorage.getItem("maddox.session") ?? "{}").entries?.map((e) => e.sliders).filter(Boolean)));
check("slider values are saved with the cell", /"sa":2,"sb":1/.test(savedSliders), savedSliders);
await page.keyboard.press("Escape"); // slider → graph
await page.keyboard.press("Escape"); // graph → cell
// In a graph, kx means k·x (k has no value): the slider is k, not kx.
await page.keyboard.press("Control+Enter");
await page.keyboard.type("plot(kx^2");
await page.keyboard.press("Enter");
await waitIdle();
await page.waitForTimeout(600);
const kSliders = await page.$$eval(".entry", (els) => [...(els.find((e) => /\(kx\^2/.test(e.querySelector("math-field")?.value ?? ""))?.querySelectorAll(".graph-slider-name") ?? [])].map((n) => n.textContent));
check("plot(kx²) gives a slider for k (kx is k·x in a graph)", kSliders.join(",") === "k", JSON.stringify(kSliders));
// The axis is never guessed: hq runs over its own t; mq and nq inside it are sliders.
await page.keyboard.press("Control+Enter");
await page.keyboard.type("hq(t");
await page.keyboard.press("ArrowRight");
await page.keyboard.type(":=mq*t+nq");
await page.keyboard.press("Shift+Enter");
await page.keyboard.type("plot(hq");
await page.keyboard.press("ArrowUp");
await page.keyboard.press("Enter");
await waitIdle();
await page.waitForTimeout(700);
const hq = await page.$$eval(".entry", (els) => {
  const el = els.find((e) => /hq\\left\(t\\right\)/.test(e.querySelector("math-field")?.value ?? ""));
  return { sliders: el?.querySelectorAll(".graph-slider").length ?? 0, curve: (el?.querySelector(".graph-curve")?.getAttribute("d") ?? "").length > 20 };
});
check("names inside a plotted function get sliders too", hq.sliders === 2 && hq.curve, JSON.stringify(hq));
await page.keyboard.type("plot(tq^2");
await page.keyboard.press("Enter");
await waitIdle();
await page.waitForTimeout(200);
check("an expression without x says so", /Use x, or define a function/.test((await resultOfCurrent()) ?? ""), await resultOfCurrent());
await page.keyboard.press("Control+g");
await page.keyboard.press("Control+Enter"); // a fresh tab
await page.keyboard.type("y=pa*x^2");
await page.waitForTimeout(900);
const rowSliders = () => page.$$eval(".panel-row", (rows) => rows.map((r) => [...r.querySelectorAll(".panel-sliders .graph-slider")].map((l) => l.querySelector(".graph-slider-name").textContent + "=" + l.querySelector(".graph-slider-value").textContent)));
check("a name without a value gets a slider inside its row (no new rows)", (await panelState()).rows.join("|") === "y=pa*x^2" && (await rowSliders())[0]?.join(",") === "pa=1" && (await panelState()).curves === 1, JSON.stringify([await panelState(), await rowSliders()]));
const panelCurve = () => page.$eval(".graph-panel .graph-curve", (p) => p.getAttribute("d"));
const panelCurveBefore = await panelCurve();
await page.keyboard.press("Alt+ArrowDown");
check("Alt+↓ goes to the row's slider", (await page.evaluate(() => document.activeElement?.getAttribute("aria-label"))) === "Slider for pa");
await page.keyboard.press("ArrowRight");
await page.waitForTimeout(600);
check("→ moves it, as under a cell's graph", (await rowSliders())[0]?.join(",") === "pa=1.1", JSON.stringify(await rowSliders()));
check("…and the curve follows the slider", (await panelCurve()) !== panelCurveBefore);
await page.keyboard.press("Escape");
check("Esc goes back to the row", (await panelState()).focus.includes("panel-input"), (await panelState()).focus);
await page.waitForTimeout(600);
const savedTabSliders = await page.evaluate(() => JSON.stringify(JSON.parse(localStorage.getItem("maddox.session") ?? "{}").graphs?.tabs?.map((t) => t.sliders)));
check("the slider value is saved with the tab", /"pa":1.1/.test(savedTabSliders), savedTabSliders);
await page.keyboard.press("Control+g");

// 36. Keep the current cell centred (Settings → Appearance, on by default):
// a cell below the middle of the window scrolls up to the middle.
const cellPosition = () => page.evaluate(() => {
  const n = document.querySelector("#notebook").getBoundingClientRect();
  const c = document.activeElement.closest(".entry").getBoundingClientRect();
  return Math.round(((c.top + c.bottom) / 2 - n.top) / n.height * 100);
});
for (let i = 0; i < 3; i++) await typeAndRun(`${i}+${i}`);
await page.waitForTimeout(700);
let centredAt = await cellPosition();
check("the current cell is centred, not left below the middle", centredAt >= 45 && centredAt <= 55, centredAt);
await openSettingsAt("centre");
await page.keyboard.press("ArrowRight"); // On → Off
await page.keyboard.press("Escape");
for (let i = 0; i < 6; i++) await typeAndRun(`${i}*2`);
await page.waitForTimeout(700);
centredAt = await cellPosition();
check("with the setting Off, cells scroll only into view", centredAt > 60, centredAt);
await openSettingsAt("centre");
await page.keyboard.press("ArrowLeft"); // back On
await page.keyboard.press("Escape");
// Going up, then down again with ↓: no cell is left below the middle
// (MathLive's own caret scroll on focus used to cut the centring short).
for (let i = 0; i < 6; i++) await page.keyboard.press("ArrowUp");
await page.waitForTimeout(600);
let worst = 0;
for (let i = 0; i < 5; i++) {
  await page.keyboard.press("ArrowDown");
  await page.waitForTimeout(700);
  worst = Math.max(worst, await cellPosition());
}
check("stepping down with ↓ keeps each cell at or above the middle", worst <= 55, worst);

// Updates: a newer version shows ↑ 9.9.9 in the status bar; Ctrl+P "Install"
// or the chip opens the update dialog, Enter installs after "Save changes?".
// In the browser a pretend update stands in for GitHub (src/updates.ts).
const FAKE = "maddox.fake-update";
const fakeUpdate = () => page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? "null"), FAKE);
const message = () => page.textContent("#message");
await page.evaluate((key) => localStorage.setItem(key, JSON.stringify({ version: "9.9.9", notes: "- Something new" })), FAKE);
await page.reload();
await page.waitForSelector("math-field");
await waitIdle();
const chipShown = await page.waitForSelector("#update-chip:not([hidden])", { timeout: 8000 }).then(() => true, () => false);
check("a newer version shows ↑ in the status bar", chipShown && (await page.textContent("#update-chip")) === "↑ 9.9.9", await page.textContent("#update-chip"));
check("…and says so once", /9\.9\.9 is available/.test(await message()), await message());
await page.keyboard.press("Control+p");
await page.keyboard.type("install maddox");
await page.keyboard.press("Enter");
await page.waitForSelector("#update-dialog[open]");
check("Ctrl+P Install opens the update dialog with the notes", (await page.textContent("#update-dialog .update-notes")) === "- Something new", await page.textContent("#update-dialog .update-notes"));
check("Enter would install", await page.evaluate(() => document.activeElement?.dataset.choice === "install"));
await page.keyboard.press("Escape");
await page.waitForTimeout(150);
check("Esc is later: back in the cell, nothing installed", (await page.evaluate(() => document.activeElement?.tagName === "MATH-FIELD")) && !(await fakeUpdate()).installed);
await page.keyboard.type("1+1");
await page.waitForTimeout(100);
await page.click("#update-chip");
await page.waitForSelector("#update-dialog[open]");
check("clicking the chip opens the update dialog", true);
await page.keyboard.press("Enter");
await page.waitForSelector("#unsaved-dialog[open]");
check("installing asks about unsaved changes first", !(await fakeUpdate()).installed);
await page.keyboard.press("d");
await page.waitForFunction((key) => JSON.parse(localStorage.getItem(key) ?? "{}").installed, FAKE, { timeout: 5000 }).catch(() => {});
check("Don't save, then it installs", (await fakeUpdate()).installed && /installed/.test(await message()), await message());
await openSettingsAt("version");
check("Settings offers the update too", (await page.textContent('#settings-dialog [data-id="version"] button')) === "Install 9.9.9", await page.textContent('#settings-dialog [data-id="version"] button'));
await page.keyboard.press("Enter");
await page.waitForSelector("#update-dialog[open]");
check("…and Enter there opens the update dialog", !(await page.isVisible("#settings-dialog[open]")));
await page.keyboard.press("Escape");
await page.waitForTimeout(150);
await page.evaluate((key) => localStorage.removeItem(key), FAKE);
await page.keyboard.press("Control+p");
await page.keyboard.type("check for updates");
await page.keyboard.press("Enter");
await page.waitForFunction(() => /newest version/.test(document.querySelector("#message")?.textContent ?? ""), null, { timeout: 5000 }).catch(() => {});
check("Check for updates says when Maddox is up to date", /is the newest version/.test(await message()) && (await page.isHidden("#update-chip")), await message());
await openSettingsAt("check-updates");
await page.keyboard.press("ArrowRight"); // On → Off
await page.keyboard.press("Escape");
await page.evaluate((key) => localStorage.setItem(key, JSON.stringify({ version: "9.9.9" })), FAKE);
await page.reload();
await page.waitForSelector("math-field");
await page.waitForTimeout(4500);
check("Check for updates: Off stays quiet at startup", await page.isHidden("#update-chip"));
await page.evaluate((key) => localStorage.removeItem(key), FAKE);
await openSettingsAt("check-updates");
await page.keyboard.press("ArrowLeft"); // back On
await page.keyboard.press("Escape");

if (shotDir) await page.screenshot({ path: `${shotDir}/maddox.png` });
check("no page errors", errors.length === 0, errors.join("\n"));

await browser.close();
console.log(failures ? `${failures} failed` : "all passed");
process.exit(failures ? 1 : 0);
