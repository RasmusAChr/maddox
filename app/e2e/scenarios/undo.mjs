// Ctrl+Z / Ctrl+Y: one undo history for the whole notebook, in the order
// things happened, whichever cell they were in.

export default async ({ page, check, waitIdle, current, entries, setAndRun, resultFor, searchRun }) => {
  const undo = async () => {
    await page.keyboard.press("Control+z");
    await page.waitForTimeout(80);
  };
  const redo = async (keys = "Control+y") => {
    await page.keyboard.press(keys);
    await page.waitForTimeout(80);
  };

  // Typing comes back a word at a time: a run of digits is one step, an
  // operator another.
  await page.keyboard.type("12+34-5");
  const steps = [];
  for (let i = 0; i < 5; i++) {
    await undo();
    steps.push(await current());
  }
  check("Ctrl+Z takes typing back a word at a time", JSON.stringify(steps) === JSON.stringify(["12+34-", "12+34", "12+", "12", ""]), JSON.stringify(steps));
  await redo();
  await redo("Control+Shift+z");
  check("Ctrl+Y and Ctrl+Shift+Z put it back", (await current()) === "12+", await current());
  await page.keyboard.type("7");
  await redo();
  check("typing after undo drops what could be redone", (await current()) === "12+7", await current());

  // The owner's example: delete a word, then the cell. The first Ctrl+Z
  // brings the cell back, the second the word.
  await page.keyboard.press("Control+Enter");
  await page.keyboard.type("41+52");
  await page.keyboard.press("Backspace");
  await page.keyboard.press("Backspace");
  check("two Backspaces deleted 52", (await current()) === "41+", await current());
  await page.keyboard.press("Control+Shift+Backspace");
  await page.waitForTimeout(100);
  check("the cell is gone", !(await entries()).includes("41+"), JSON.stringify(await entries()));
  await undo();
  check("Ctrl+Z brings the deleted cell back, with the caret in it", (await current()) === "41+", await current());
  check("in its old place", JSON.stringify(await entries()) === JSON.stringify(["12+7", "41+"]), JSON.stringify(await entries()));
  await undo();
  check("Ctrl+Z again brings back the deleted word", (await current()) === "41+52", await current());

  // Steps follow the order they happened in, across cells.
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("End");
  await page.keyboard.type("0");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("End");
  await page.keyboard.type("6");
  check("typed in both cells", JSON.stringify(await entries()) === JSON.stringify(["12+70", "41+526"]), JSON.stringify(await entries()));
  await undo();
  await undo();
  check("Ctrl+Z goes back through both cells, newest first", JSON.stringify(await entries()) === JSON.stringify(["12+7", "41+52"]), JSON.stringify(await entries()));
  check("and the caret follows the change", (await current()) === "12+7", await current());

  // A new cell (Ctrl+Enter) is a step too.
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Control+Enter");
  check("Ctrl+Enter added a cell", (await entries()).length === 3, JSON.stringify(await entries()));
  await undo();
  check("Ctrl+Z removes it again", (await entries()).length === 2 && (await current()) === "41+52", JSON.stringify(await entries()));

  // Alt+Enter (this cell as decimals) is a step.
  const chipShown = () => page.evaluate(() => !document.activeElement.closest(".entry").querySelector(".answers-chip").hidden);
  await page.keyboard.press("Alt+Enter");
  await waitIdle();
  check("Alt+Enter shows the ≈ chip", (await chipShown()) === true);
  await undo();
  await waitIdle();
  check("Ctrl+Z switches the cell back", (await chipShown()) === false);

  // A deleted definition comes back with its results, and the cells using
  // it recalculate.
  await setAndRun(String.raw`uz\coloneq5`);
  await setAndRun(String.raw`uz+1`);
  check("uz + 1 is 6", (await resultFor("uz+1")) === "6", await resultFor("uz+1"));
  for (let i = 0; i < 10 && (await current()) !== "uz\\coloneq5"; i++) {
    await page.keyboard.press("ArrowUp");
    await page.waitForTimeout(50);
  }
  await page.keyboard.press("Control+Shift+Backspace");
  await page.waitForTimeout(300);
  await waitIdle();
  await page.waitForTimeout(100);
  check("deleting uz := 5 clears uz", (await resultFor("uz+1")) !== "6", await resultFor("uz+1"));
  await undo();
  await page.waitForTimeout(300);
  await waitIdle();
  await page.waitForTimeout(100);
  check("Ctrl+Z brings uz := 5 back with its result", (await resultFor("uz\\coloneq")) === "5", await resultFor("uz\\coloneq"));
  check("and uz + 1 is 6 again", (await resultFor("uz+1")) === "6", await resultFor("uz+1"));
  await page.keyboard.press("End");
  await page.keyboard.type("0");
  check("the restored cell still takes typing", (await current()) === "uz\\coloneq50", await current());
  await page.keyboard.type("pi");
  check("and its typing shortcuts (pi is π)", (await current()) === "uz\\coloneq50\\pi", await current());

  // Ctrl+P has Undo and Redo too.
  await searchRun("undo");
  // 0 and pi were typed as one run of letters and digits: one step.
  check("Ctrl+P Undo takes back the last change", (await current()) === "uz\\coloneq5", await current());
  await searchRun("redo");
  check("Ctrl+P Redo puts it back", (await current()) === "uz\\coloneq50\\pi", await current());
};
