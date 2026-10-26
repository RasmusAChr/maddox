// Updates: the ↑ chip, the update dialog, Check for updates, and the setting.
// About Maddox: the version, licences and sources.
// A pretend update stands in for GitHub (src/updates.ts).

export default async ({ page, check, waitIdle, chip, closeSettings, openSettingsAt, searchRun, active }) => {
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
  await closeSettings();
  await page.evaluate((key) => localStorage.setItem(key, JSON.stringify({ version: "9.9.9" })), FAKE);
  await page.reload();
  await page.waitForSelector("math-field");
  await page.waitForTimeout(4500);
  check("Check for updates: Off stays quiet at startup", await page.isHidden("#update-chip"));
  await page.evaluate((key) => localStorage.removeItem(key), FAKE);
  await openSettingsAt("check-updates");
  await page.keyboard.press("ArrowLeft"); // back On
  await closeSettings();

  // About Maddox (Ctrl+P): version, the licences and where the source is
  // (the full GPL text is linked, and comes with the installer). Esc closes.
  await searchRun("about maddox");
  await page.waitForSelector("#about-dialog[open]");
  const about = await page.$eval("#about-dialog", (d) => ({
    version: d.querySelector(".about-version").textContent,
    text: d.textContent,
    heading: parseFloat(getComputedStyle(d.querySelector("h2")).fontSize),
    body: parseFloat(getComputedStyle(d.querySelector("p")).fontSize),
  }));
  check("About shows the version, Giac's authors and both sources", /\d+\.\d+\.\d+/.test(about.version) && /Parisse/.test(about.text) && /github\.com\/RasmusAChr\/maddox/.test(about.text) && /engine-giac-1\.9\.0/.test(about.text), JSON.stringify({ ...about, text: undefined }));
  check("…links the licence instead of printing it, with a large title", /gnu\.org\/licenses\/gpl-3\.0/.test(about.text) && !/Preamble/.test(about.text) && about.heading >= about.body * 1.5, JSON.stringify({ heading: about.heading, body: about.body }));
  await page.keyboard.press("Escape");
  await page.waitForTimeout(100);
  check("Esc closes About and returns to the notebook", !(await page.$eval("#about-dialog", (d) => d.open)) && (await active()).startsWith("MATH-FIELD"), await active());
};
