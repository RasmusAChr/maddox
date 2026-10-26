// Arithmetic, matrices (Ctrl+M, Alt+arrows, boxes), functions, errors,
// Esc cancelling a long computation, multi-line cells, Ctrl+←/→ jumps,
// implied multiplication, and \alp suggestions.

export default async ({ page, check, waitIdle, entries, resultOf, hints, current }) => {
  // Plain arithmetic: exact result plus decimal.
  // "/" builds a fraction and leaves the caret in the denominator; → leaves it.
  await page.keyboard.type("1/3");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.type("+1/6");
  await page.keyboard.press("Enter");
  await waitIdle();
  let r = await resultOf(0);
  check("fraction arithmetic", r.exact === "\\frac{1}{2}" && r.approx, JSON.stringify(r));
  check("Enter opens a new entry", (await entries()).length === 2, JSON.stringify(await entries()));

  // Matrix via Ctrl+M, filled with Tab, grown and shrunk with Alt+arrows.
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

  // Evaluate the matrix inverse.
  await page.keyboard.press("End");
  await page.keyboard.type("^-1");
  await page.keyboard.press("Enter");
  await waitIdle();
  r = await resultOf(1);
  check("matrix inverse", r.exact?.includes("\\frac{3}{2}") ?? false, JSON.stringify(r));

  // Variables, functions, ans (Enter above opened a fresh entry).
  // A one-digit exponent is left automatically (MathLive's smartSuperscript).
  await page.keyboard.type("f(x):=x^2+1");
  await page.keyboard.press("Enter");
  await page.keyboard.type("f(3)");
  await page.keyboard.press("Enter");
  await waitIdle();
  const list = await entries();
  r = await resultOf(list.length - 2);
  check("user-defined function", r.exact === "10", JSON.stringify({ r, list }));

  // Search (Ctrl+K still works as an alias of Ctrl+P), insert solve.
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

  // Errors are shown, not thrown.
  await page.keyboard.type("1+");
  await page.keyboard.press("Enter");
  await waitIdle();
  const n = (await entries()).length;
  r = await resultOf(n - 2);
  check("error message", !!r.error, JSON.stringify(r));

  // Backspace on an empty entry removes it.
  await page.keyboard.press("Backspace");
  await page.keyboard.press("Backspace");
  check("Backspace removes an empty entry", (await entries()).length === n - 1, JSON.stringify(await entries()));
  await page.keyboard.press("Control+Enter");
  await page.keyboard.press("Control+Backspace");
  check("so does Ctrl+Backspace", (await entries()).length === n - 1, JSON.stringify(await entries()));

  // Esc cancels a long computation; the restarted engine keeps working.
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

  // Shift+Enter starts a new line in the same entry; "#" at line start makes it text.
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

  // Every empty matrix cell shows a box: new columns get them, and a cell
  // emptied with Backspace gets its box back (the box itself can't be deleted).
  await page.keyboard.press("Control+Enter");
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

  // Ctrl+←/→ jump like in a text editor and never get stuck at a group edge.
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

  // A name before brackets multiplies unless it is a function.
  await page.keyboard.press("Control+Enter");
  await page.keyboard.type("expand(3x(4y+8z");
  await page.keyboard.press("Enter");
  await waitIdle();
  const products = await page.$$eval(".entry .exact", (els) => els.map((e) => e.dataset.latex));
  check("3x(4y+8z) multiplies", products.includes("12\\cdot x\\cdot y+24\\cdot x\\cdot z"), JSON.stringify(products.slice(-2)));

  // Typing \alp offers \alpha; Enter takes the suggestion instead of evaluating.
  await page.keyboard.press("Control+Enter");
  await page.keyboard.type("2\\alp");
  await page.waitForTimeout(150);
  const cellCount = (await entries()).length;
  await page.keyboard.press("Enter");
  await page.waitForTimeout(200);
  const latexDone = await page.evaluate(() => ({ value: document.activeElement?.value, mode: document.activeElement?.mode }));
  check("Enter on a \\alp suggestion types α and stays in the cell", latexDone.value === "2\\alpha" && latexDone.mode === "math" && (await entries()).length === cellCount, JSON.stringify(latexDone));
  await page.keyboard.press("Enter");
  await waitIdle();
  const alphaResult = await page.$$eval(".entry", (els) => els.find((e) => e.querySelector("math-field")?.value === "2\\alpha")?.querySelector(".exact")?.dataset.latex ?? null);
  check("…and the next Enter evaluates", alphaResult !== null, alphaResult);
};
