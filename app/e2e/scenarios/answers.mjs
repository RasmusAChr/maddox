// Readable answers (solve style, six digits, plain-word errors) and Alt+Enter
// switching one cell to decimals.

export default async ({ page, check, waitIdle, current, setAndRun, resultFor, chip, searchRun }) => {
  // Readable answers: solve as equations (default) or sets (Ctrl+P option),
  // six-digit decimals, and errors in plain words.
  await setAndRun(String.raw`\operatorname{solve}\left(x^2-5x+6=0,x\right)`);
  check("solve answers read x = 2 or x = 3", (await resultFor("x^2-5x")) === "x=2\\text{ or }x=3", await resultFor("x^2-5x"));
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

  // Alt+Enter switches one cell to decimals (≈ marker, saved with the
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
};
