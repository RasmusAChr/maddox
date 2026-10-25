// How the notebook looks: results never scroll, leader dots, headings,
// zoom, scroll room, stacked results, and keeping the current cell centred.

export default async ({ page, check, waitIdle, entries, current, setAndRun, typeAndRun, closeSettings, openSettingsAt }) => {
  // A notebook that fits has no scrollbar; a tall one gets room to scroll
  // the last cell up off the bottom edge.
  const scrollRoom = () => page.evaluate(() => {
    const nb = document.querySelector("#notebook");
    return nb.scrollHeight - nb.clientHeight;
  });
  check("a notebook that fits doesn't scroll", (await scrollRoom()) <= 0, await scrollRoom());

  // Results never scroll: tall ones grow the cell, too-wide ones wrap below
  // the input, and only a result wider than the whole cell scrolls (on its own).
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

  // Full-screen look: leader dots join inputs to results, # lines are
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

  // Results of one multi-line cell keep a little air between them, even
  // when they are taller than their lines (stacked matrices).
  await setAndRun("\\displaylines{Ma\\coloneq\\begin{pmatrix}1&1\\\\1&3\\end{pmatrix}\\\\ Mb\\coloneq\\begin{pmatrix}3\\\\8\\end{pmatrix}\\\\ \\operatorname{transpose}(Ma)}");
  const gaps = await page.$$eval(".entry", (els) => {
    const el = els.find((e) => e.querySelector("math-field")?.value.includes("Ma\\coloneq"));
    const boxes = [...el.querySelectorAll(".result-line .exact")].map((x) => x.getBoundingClientRect());
    return boxes.slice(1).map((b, i) => Math.round(b.top - boxes[i].bottom));
  });
  check("stacked results don't touch", gaps.length === 2 && gaps.every((g) => g >= 6), JSON.stringify(gaps));

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

  // Keep the current cell centred (Settings → Appearance, on by default):
  // a cell below the middle of the window scrolls up to the middle.
  const cellPosition = () => page.evaluate(() => {
    const n = document.querySelector("#notebook").getBoundingClientRect();
    const c = document.activeElement.closest(".entry").getBoundingClientRect();
    return Math.round(((c.top + c.bottom) / 2 - n.top) / n.height * 100);
  });
  for (let i = 0; i < 3; i++) await typeAndRun(`${i}+${i}`);
  await page.waitForTimeout(700);
  let centredAt = await cellPosition();
  check("the current cell is centred, not left below the middle", centredAt >= 45 && centredAt <= 55, centredAt);
  await openSettingsAt("centre");
  await page.keyboard.press("ArrowRight"); // On → Off
  await closeSettings();
  for (let i = 0; i < 6; i++) await typeAndRun(`${i}*2`);
  await page.waitForTimeout(700);
  centredAt = await cellPosition();
  check("with the setting Off, cells scroll only into view", centredAt > 60, centredAt);
  await openSettingsAt("centre");
  await page.keyboard.press("ArrowLeft"); // back On
  await closeSettings();
  // Going up, then down again with ↓: no cell is left below the middle
  // (MathLive's own caret scroll on focus used to cut the centring short).
  for (let i = 0; i < 6; i++) await page.keyboard.press("ArrowUp");
  await page.waitForTimeout(600);
  let worst = 0;
  for (let i = 0; i < 5; i++) {
    await page.keyboard.press("ArrowDown");
    await page.waitForTimeout(700);
    worst = Math.max(worst, await cellPosition());
  }
  check("stepping down with ↓ keeps each cell at or above the middle", worst <= 55, worst);
};
