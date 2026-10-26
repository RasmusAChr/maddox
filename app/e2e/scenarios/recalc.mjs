// Changing a definition recalculates the cells that use it.

export default async ({ page, check, waitIdle, current, setAndRun, resultFor }) => {
  // Changing a definition recalculates the cells below that use it (and
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
};
