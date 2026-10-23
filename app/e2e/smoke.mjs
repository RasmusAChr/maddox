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

if (shotDir) await page.screenshot({ path: `${shotDir}/maddox.png` });
check("no page errors", errors.length === 0, errors.join("\n"));

await browser.close();
console.log(failures ? `${failures} failed` : "all passed");
process.exit(failures ? 1 : 0);
