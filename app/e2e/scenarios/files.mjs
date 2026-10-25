// Never lose work (New asks first), and typing goes on after a dialog.

export default async ({ page, check, entries }) => {
  // Never lose work: New with unsaved changes asks first. Esc keeps
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

  // After a dialog closes, typing goes on in the cell (reported bug: type
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
};
