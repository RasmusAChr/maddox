// Export: copy a result (Ctrl+Shift+C, or as LaTeX from Ctrl+P), and
// print / save as PDF (Ctrl+Shift+P) with only the notebook on the page.

export default async ({ page, check, active, setAndRun, searchRun }) => {
  // The clipboard and the print dialog are stood in for.
  await page.evaluate(() => {
    window.__copied = [];
    navigator.clipboard.writeText = async (text) => { window.__copied.push(text); };
    window.__printed = null;
    window.print = () => {
      const root = document.documentElement;
      window.__printed = {
        printing: root.classList.contains("printing"),
        theme: root.dataset.theme ?? null,
        title: document.querySelector("#print-title").textContent,
        date: document.querySelector("#print-date").textContent,
        blank: document.querySelectorAll(".entry.blank").length,
      };
    };
  });
  const copied = () => page.evaluate(() => window.__copied.at(-1) ?? null);
  const message = () => page.textContent("#message");

  await setAndRun(String.raw`\frac{1}{3}+\frac{1}{6}`);
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("Control+Shift+c");
  await page.waitForTimeout(100);
  check("Ctrl+Shift+C copies the result as plain text", (await copied()) === "1/2 ≈ 0.5", await copied());
  check("and says what it copied", (await message()).includes("Copied: 1/2"), await message());
  await searchRun("copy result as latex");
  check("Ctrl+P copies it as LaTeX", (await copied()) === "\\frac{1}{2} \\approx 0.5", await copied());
  await setAndRun(String.raw`\operatorname{solve}\left(x^2=2,x\right)`);
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("Control+Shift+c");
  await page.waitForTimeout(100);
  check("words and roots read as typed", /^x=-?sqrt\(2\) or x=-?sqrt\(2\)/.test((await copied()) ?? ""), await copied());
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Control+Shift+c");
  await page.waitForTimeout(100);
  check("a line without a result says so", (await message()).includes("no result"), await message());

  // Print: a fixed width, the light theme, empty cells left out; the
  // dialog closing puts everything back.
  await page.evaluate(() => { document.documentElement.dataset.theme = "dark"; });
  await page.keyboard.press("Control+Shift+p");
  await page.waitForFunction(() => window.__printed);
  const printed = await page.evaluate(() => window.__printed);
  check("Ctrl+Shift+P prints in the light theme at print width", printed.printing && printed.theme === "light", JSON.stringify(printed));
  check("with the notebook's name and the date on top", printed.title === "Untitled" && /\d{4}$/.test(printed.date), JSON.stringify(printed));
  check("leaving out the empty cells", printed.blank === 2, JSON.stringify(printed));
  await page.emulateMedia({ media: "print" });
  const shown = await page.evaluate(() => ({
    topbar: getComputedStyle(document.querySelector(".topbar")).display,
    status: getComputedStyle(document.querySelector(".statusbar")).display,
    header: getComputedStyle(document.querySelector(".print-header")).display,
    cells: [...document.querySelectorAll(".entry")].filter((e) => getComputedStyle(e).display !== "none").length,
  }));
  check("on paper: no toolbar or status bar, a header, the cells", shown.topbar === "none" && shown.status === "none" && shown.header === "flex" && shown.cells === 2, JSON.stringify(shown));
  await page.emulateMedia({ media: "screen" });
  await page.evaluate(() => window.dispatchEvent(new Event("afterprint")));
  await page.waitForTimeout(150);
  const after = await page.evaluate(() => ({ printing: document.documentElement.classList.contains("printing"), theme: document.documentElement.dataset.theme }));
  check("after printing, the screen is as it was", !after.printing && after.theme === "dark", JSON.stringify(after));
  check("and the keyboard is back in a cell", (await active()).startsWith("MATH-FIELD"), await active());
  await page.evaluate(() => { delete document.documentElement.dataset.theme; });
};
