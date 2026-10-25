// Shared by the e2e scenarios (scenarios/*.mjs, run by run.mjs): opening
// the app, check(), and the helpers several scenarios use. A scenario is
// `export default async (t) => {…}` with t = { page, check, ...helpers }.
import { chromium } from "playwright-core";
import { existsSync } from "node:fs";

export const URL = process.env.MADDOX_URL ?? "http://localhost:1420/";

/**
 * The browser (a fresh context per scenario: empty localStorage) or, with
 * MADDOX_CDP, the desktop app's one window (cleared and reloaded instead).
 */
export async function connect() {
  const cdp = process.env.MADDOX_CDP;
  if (cdp) {
    const browser = await chromium.connectOverCDP(cdp);
    const page = browser.contexts()[0].pages()[0];
    return {
      browser,
      async newPage() {
        await page.evaluate(() => localStorage.clear());
        await page.reload();
        return { page, close: async () => {} };
      },
    };
  }
  const candidates = [
    process.env.BROWSER_PATH,
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/usr/bin/microsoft-edge",
  ].filter(Boolean);
  const executablePath = candidates.find((p) => existsSync(p));
  if (!executablePath) throw new Error("No Chromium-based browser found; set BROWSER_PATH");
  const browser = await chromium.launch({ executablePath, headless: !process.env.HEADED });
  return {
    browser,
    async newPage() {
      const context = await browser.newContext({ viewport: { width: 1200, height: 800 } });
      const page = await context.newPage();
      await page.goto(URL);
      return { page, close: () => context.close() };
    },
  };
}

/** The helpers, bound to one page. */
export function helpers(page) {
  const waitIdle = () => page.waitForSelector('#engine-status[data-status="ready"]', { timeout: 60_000 });
  const entries = () => page.$$eval("math-field", (fields) => fields.map((f) => f.value));
  const resultOf = (i) =>
    page.$eval(`.entry:nth-child(${i + 1}) .entry-result`, (r) => ({
      exact: r.querySelector(".exact")?.dataset.latex ?? null,
      approx: !!r.querySelector(".approx"),
      error: r.querySelector(".error")?.textContent ?? null,
    }));
  const hints = () => page.textContent("#hints");
  /** The focused field's value (the cell being edited). */
  const current = async () => page.evaluate(() => document.activeElement?.value ?? "");
  /** What has focus, as TAG.class. */
  const active = () => page.evaluate(() => document.activeElement?.tagName + "." + document.activeElement?.className);
  /** A new cell below with this LaTeX, evaluated. */
  const setAndRun = async (latex) => {
    await page.keyboard.press("Control+Enter");
    await page.evaluate((l) => { document.activeElement.value = l; }, latex);
    await page.keyboard.press("Enter");
    await waitIdle();
    await page.waitForTimeout(100);
  };
  /** A new cell below with this typed, evaluated. */
  const typeAndRun = async (text) => {
    await page.keyboard.press("Control+Enter");
    await page.keyboard.type(text);
    await page.keyboard.press("Enter");
    await waitIdle();
    await page.waitForTimeout(100);
  };
  /** The exact result of the first cell whose input contains `needle`. */
  const resultFor = (needle) => page.$$eval(".entry", (els, n) => {
    const el = els.find((e) => e.querySelector("math-field")?.value.includes(n));
    return el?.querySelector(".exact")?.dataset.latex ?? null;
  }, needle);
  /** The decimal shown for the cell whose input is exactly `latex`. */
  const approxOf = (latex) =>
    page.$$eval(".entry", (els, latex) => els.find((e) => e.querySelector("math-field")?.value === latex)?.querySelector(".approx")?.textContent ?? null, latex);
  /** The result (or error) of the cell just above the focused one. */
  const resultOfCurrent = () => page.evaluate(() => {
    const el = document.activeElement.closest(".entry").previousElementSibling;
    return el?.querySelector(".exact")?.dataset.latex ?? el?.querySelector(".error")?.textContent ?? null;
  });
  const chip = () => page.textContent("#angle-chip");
  /** Ctrl+P, type q, Enter, and wait for any re-run it starts. */
  const searchRun = async (q) => {
    await page.keyboard.press("Control+p");
    await page.waitForSelector("#search-dialog[open]");
    await page.keyboard.type(q);
    await page.keyboard.press("Enter");
    await page.waitForTimeout(150);
    await waitIdle();
    await page.waitForTimeout(150);
  };
  /** After a change that re-runs the notebook. */
  const settled = async () => {
    await page.waitForTimeout(150);
    await waitIdle();
    await page.waitForTimeout(150);
  };

  // Settings (Ctrl+,): tabs on the left, settings on the right.
  const focusedSetting = () => page.evaluate(() => document.activeElement?.closest(".setting")?.dataset.id ?? null);
  const focusedTab = () => page.evaluate(() => document.activeElement?.closest(".settings-tab")?.dataset.section ?? null);
  const settingsOpen = () => page.isVisible("#settings-dialog[open]");
  const closeSettings = async () => {
    for (let i = 0; i < 2 && (await settingsOpen()); i++) await page.keyboard.press("Escape");
    await page.waitForTimeout(150);
  };
  /** Opens settings fresh, goes to the tab holding setting `id`, and onto it. */
  const openSettingsAt = async (id) => {
    await closeSettings();
    await page.keyboard.press("Control+,");
    await page.waitForSelector("#settings-dialog[open]");
    for (let i = 0; i < 6; i++) await page.keyboard.press("ArrowUp");
    for (let i = 0; i < 6 && !(await page.$(`#settings-dialog .setting[data-id="${id}"]`)); i++) await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    for (let i = 0; i < 6 && (await focusedSetting()) !== id; i++) await page.keyboard.press("ArrowDown");
  };

  return {
    waitIdle, entries, resultOf, hints, current, active, setAndRun, typeAndRun, resultFor, approxOf, resultOfCurrent,
    chip, searchRun, settled, focusedSetting, focusedTab, settingsOpen, closeSettings, openSettingsAt,
  };
}
