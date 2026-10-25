// Degrees / radians per notebook (Ctrl+Shift+A, the chip, 30°), kept
// across an engine restart and saved in the file.
import { readFile } from "node:fs/promises";

export default async ({ page, check, waitIdle, entries, setAndRun, resultFor, chip }) => {
  // Degrees / radians: a new notebook starts in degrees, Ctrl+Shift+A
  // switches and re-runs everything, 30deg types 30° (always degrees), and
  // the mode is saved in the notebook file.
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
};
