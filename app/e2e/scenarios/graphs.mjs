// Graphs: plot(…) under a cell, tracing and zoom, the Ctrl+G panel with tabs,
// points worth knowing, and sliders.

export default async ({ page, check, waitIdle, entries, hints, current, active, resultFor, resultOfCurrent }) => {
  // Graphs: plot(…) draws below the cell; Alt+↓ goes in, ←/→ trace, + zooms
  // (saved with the cell), 0 resets, Esc goes back.
  await page.keyboard.press("Control+Enter");
  await page.keyboard.type("fp(x");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.type(":=x^2-2");
  await page.keyboard.press("Shift+Enter");
  await page.keyboard.type("plot(fp,x");
  await page.waitForTimeout(100);
  const plotCell = () => page.$$eval(".entry", (els) => {
    const el = els.find((e) => /plot\}+\\left\(/.test(e.querySelector("math-field")?.value ?? ""));
    return el ? { curves: [...el.querySelectorAll(".graph-curve")].filter((p) => (p.getAttribute("d") ?? "").length > 20).length, note: el.querySelector(".graph-note")?.textContent ?? null } : null;
  });
  check("typing plot( gives the plot command", /operatorname\{(\\mathrm\{)?plot\}/.test(await current()), await current());
  await page.keyboard.press("ArrowUp"); // back to the first line, so Enter evaluates the whole cell
  await page.keyboard.press("Enter");
  await waitIdle();
  await page.waitForTimeout(600);
  check("plot draws both curves below the cell", (await plotCell())?.curves === 2, JSON.stringify(await plotCell()));
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("Alt+ArrowDown");
  const inGraph = () => page.evaluate(() => document.activeElement?.classList.contains("graph") ?? false);
  const readout = () => page.$eval(".graph:focus .graph-readout", (el) => el.textContent);
  check("Alt+↓ moves into the graph", await inGraph(), await active());
  check("the hints explain the graph keys", /Graph/.test(await hints()), await hints());
  await page.keyboard.press("ArrowRight");
  await page.waitForTimeout(200);
  check("→ starts tracing at x = 0", /x = 0,\s+y = −2/.test(await readout()), await readout());
  await page.keyboard.press("ArrowRight");
  await page.waitForTimeout(200);
  check("→ steps along the curve", /x = 0\.2,\s+y = −1\.96/.test(await readout()), await readout());
  await page.keyboard.press("ArrowDown");
  await page.waitForTimeout(200);
  check("↓ switches to the next curve", /x = 0\.2,\s+y = 0\.2/.test(await readout()), await readout());
  await page.keyboard.press("+");
  await page.waitForTimeout(700);
  const savedView = await page.evaluate(() => localStorage.getItem("maddox.session"));
  check("a zoomed view is saved with the cell", /"views":\{"1":\{"xmin"/.test(savedView ?? ""), savedView?.slice(-300));
  await page.keyboard.press("0");
  await page.waitForTimeout(700);
  const resetView = await page.evaluate(() => localStorage.getItem("maddox.session"));
  check("0 resets to the automatic view", !/"views"/.test(resetView ?? ""), resetView?.slice(-300));
  await page.keyboard.press("Escape");
  check("Esc goes back to the cell", (await active()).startsWith("MATH-FIELD") && (await current()).includes("plot"), await active());

  // The graph panel (Ctrl+G): a list per tab above a graph, tabs by
  // keyboard, F6 between notebook and panel, Ctrl+Shift+G from a cell line.
  const panelState = () => page.evaluate(() => ({
    open: !document.querySelector("#graph-panel").hidden,
    focus: document.activeElement?.className ?? "",
    inPanel: document.querySelector("#graph-panel").contains(document.activeElement),
    rows: [...document.querySelectorAll(".panel-input")].map((m) => m.value),
    tabs: [...document.querySelectorAll(".panel-tab")].map((t) => (t.getAttribute("aria-selected") === "true" ? "*" : "") + t.firstChild.textContent),
    curves: [...document.querySelectorAll(".graph-panel .graph-curve")].filter((p) => (p.getAttribute("d") ?? "").length > 20).length,
  }));
  await page.keyboard.press("Control+g");
  await page.waitForTimeout(200);
  let ps = await panelState();
  check("Ctrl+G opens the panel with the keyboard in its list", ps.open && ps.focus.includes("panel-input"), JSON.stringify(ps));
  await page.keyboard.type("fp");
  await page.keyboard.press("Enter");
  await page.keyboard.type("x");
  await page.waitForTimeout(1200);
  ps = await panelState();
  check("each row of the list is drawn", ps.curves === 2 && ps.rows.join("|") === "fp|x", JSON.stringify(ps));
  await page.keyboard.press("Enter");
  await page.keyboard.type("fp(5");
  await page.waitForTimeout(1200);
  const rowValue = await page.$$eval(".panel-row.has-value .panel-value", (els) => els.map((e) => e.textContent));
  const panelDots = () => page.$$eval(".graph-panel .graph-point", (els) => els.map((e) => [e.getAttribute("cx"), e.getAttribute("cy")]));
  check("f(5) in a row shows = 23 and marks its point", rowValue.length === 1 && /=\s*23/.test(rowValue[0]) && (await panelState()).curves === 2 && (await panelDots()).length === 1, JSON.stringify([rowValue, await panelDots()]));
  await page.keyboard.press("Control+a");
  await page.keyboard.press("Backspace");
  await page.keyboard.press("Backspace"); // the now empty row goes
  await page.waitForTimeout(300);
  await page.keyboard.press("ArrowDown");
  check("↓ from the last row goes into the graph", (await page.evaluate(() => document.activeElement?.classList.contains("graph"))) === true, (await panelState()).focus);
  await page.keyboard.press("Escape");
  check("Esc in the graph goes back to the list", (await panelState()).focus.includes("panel-input"), (await panelState()).focus);
  await page.keyboard.press("Control+Enter");
  await page.waitForTimeout(200);
  ps = await panelState();
  check("Ctrl+Enter makes a new tab", ps.tabs.join("|") === "Graph 1|*Graph 2" && ps.rows.join("|") === "", JSON.stringify(ps));
  await page.keyboard.press("Control+PageUp");
  await page.waitForTimeout(200);
  ps = await panelState();
  check("Ctrl+PageUp goes back to the first tab and its list", ps.tabs[0] === "*Graph 1" && ps.rows.join("|") === "fp|x", JSON.stringify(ps));
  await page.keyboard.press("F2");
  await page.keyboard.type("Parabola");
  await page.keyboard.press("Enter");
  ps = await panelState();
  check("F2 renames the tab", ps.tabs[0] === "*Parabola" && ps.focus.includes("panel-input"), JSON.stringify(ps));
  await page.keyboard.press("F6");
  check("F6 goes to the notebook", !(await panelState()).inPanel && (await active()).startsWith("MATH-FIELD"), await active());
  await page.keyboard.press("Control+Shift+g");
  await page.waitForTimeout(800);
  ps = await panelState();
  check("Ctrl+Shift+G adds the line's items to the open tab", ps.rows.join("|") === "fp|x|fp|x" && !ps.inPanel, JSON.stringify(ps));
  await page.keyboard.press("F6");
  check("F6 goes back to the panel", (await panelState()).inPanel, (await panelState()).focus);
  await page.waitForTimeout(600);
  const savedPanel = await page.evaluate(() => JSON.parse(localStorage.getItem("maddox.session") ?? "{}").graphs);
  check("the panel is saved: open, tabs, lists", savedPanel?.open === true && savedPanel.tabs?.[0]?.name === "Parabola" && savedPanel.tabs[1]?.name === "Graph 2", JSON.stringify(savedPanel));
  // g(x) = … defines g for this tab only; := is for cells.
  await page.keyboard.press("Control+Enter");
  await page.keyboard.type("gl(x");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.type("=2x+3");
  await page.keyboard.press("Enter");
  await page.keyboard.type("gl(0");
  await page.keyboard.press("Enter");
  await page.keyboard.type("hl(x");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.type(":=x");
  await page.waitForTimeout(1500);
  const localRows = await page.$$eval(".panel-row", (rows) => rows.map((r) => ({ value: r.querySelector(".panel-value")?.textContent ?? "", error: r.querySelector(".panel-error")?.textContent ?? "" })));
  ps = await panelState();
  check("g(x) = … in a graph row is drawn and usable by other rows", ps.curves === 1 && /=\s*3/.test(localRows[1]?.value ?? ""), JSON.stringify([ps, localRows]));
  check(":= in a graph row says to use = (or a cell)", /Use = to define hl in this graph/.test(localRows[2]?.error ?? ""), JSON.stringify(localRows[2]));
  await page.keyboard.press("F6");
  await page.keyboard.press("Control+Enter");
  await page.keyboard.type("gl(1");
  await page.keyboard.press("Enter");
  await waitIdle();
  await page.waitForTimeout(150);
  check("the graph's own g is not defined in the notebook", (await resultFor("gl\\left(1")) !== "5", await resultFor("gl\\left(1"));
  await page.keyboard.press("F6");
  await page.keyboard.press("Control+g");
  ps = await panelState();
  check("Ctrl+G closes it and returns to the notebook", !ps.open && (await active()).startsWith("MATH-FIELD"), JSON.stringify(ps));

  // Points worth knowing: tracing a curve shows its zeros, max/min,
  // y-intercept and intersections as dots; Tab jumps between them, named exactly.
  await page.keyboard.press("Control+Enter");
  await page.keyboard.type("plot(fp,x");
  await page.keyboard.press("Enter");
  await waitIdle();
  await page.waitForTimeout(500);
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("Alt+ArrowDown");
  await page.keyboard.press("ArrowRight"); // trace fp from x = 0
  await page.waitForTimeout(1200);
  const focusedGraph = () => page.evaluate(() => {
    const g = document.activeElement;
    return { dots: g?.querySelectorAll(".graph-feature").length ?? 0, readout: g?.querySelector(".graph-readout")?.textContent ?? "" };
  });
  let fg = await focusedGraph();
  check("tracing a curve shows its points worth knowing", fg.dots === 6 && /Tab: zeros/.test(fg.readout), JSON.stringify(fg));
  await page.keyboard.press("Tab");
  fg = await focusedGraph();
  check("Tab jumps to the next one: the zero √2", /Zero/.test(fg.readout) && /1\.41421/.test(fg.readout), fg.readout);
  await page.keyboard.press("Tab");
  fg = await focusedGraph();
  check("…then the intersection with x at (2, 2)", /Intersection/.test(fg.readout) && /with/.test(fg.readout), fg.readout);
  await page.keyboard.press("Shift+Tab");
  fg = await focusedGraph();
  check("Shift+Tab goes back", /Zero/.test(fg.readout), fg.readout);
  check("Tab keeps the keyboard in the graph", await inGraph(), await active());
  await page.keyboard.press("Escape");

  // Sliders: names without a value get one under an inline graph (S goes to
  // it, ←/→ change it, saved with the cell); in the panel, Enter adds a = 1 rows
  // whose sliders Alt+←/→ nudge.
  await page.keyboard.press("Control+Enter");
  await page.keyboard.type("plot(sa*x^2+sb");
  await page.keyboard.press("Enter");
  await waitIdle();
  await page.waitForTimeout(600);
  const sliderCell = () => page.$$eval(".entry", (els) => {
    const el = els.find((e) => /sa\*x\^2\+sb/.test(e.querySelector("math-field")?.value ?? ""));
    if (!el) return null;
    const graph = el.querySelector(".graph");
    return {
      names: [...el.querySelectorAll(".graph-slider-name")].map((n) => n.textContent),
      values: [...el.querySelectorAll(".graph-slider-value")].map((n) => n.textContent),
      curve: el.querySelector(".graph-curve")?.getAttribute("d")?.slice(0, 80) ?? "",
      fits: graph ? graph.getBoundingClientRect().right <= el.getBoundingClientRect().right + 1 : false,
    };
  });
  const inView = await page.evaluate(() => {
    const n = document.querySelector("#notebook").getBoundingClientRect();
    const a = document.activeElement.getBoundingClientRect();
    return a.top >= n.top && a.bottom <= n.bottom;
  });
  check("after Enter the caret's cell stays in view below the new graph", inView);
  let sc = await sliderCell();
  check("names without a value get sliders under the graph", sc?.names.join(",") === "sa,sb" && sc.values.join(",") === "1,1", JSON.stringify(sc));
  check("the graph fits inside its cell", sc?.fits === true, JSON.stringify(sc));
  const curveBefore = sc?.curve;
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("Alt+ArrowDown");
  await page.keyboard.press("s");
  check("S goes to the first slider", (await page.evaluate(() => document.activeElement?.getAttribute("aria-label"))) === "Slider for sa");
  await page.keyboard.press("Shift+ArrowRight");
  await page.waitForTimeout(700);
  sc = await sliderCell();
  check("Shift+→ moves the slider by 1 and the curve follows", sc?.values[0] === "2" && sc.curve !== curveBefore, JSON.stringify(sc));
  const savedSliders = await page.evaluate(() => JSON.stringify(JSON.parse(localStorage.getItem("maddox.session") ?? "{}").entries?.map((e) => e.sliders).filter(Boolean)));
  check("slider values are saved with the cell", /"sa":2,"sb":1/.test(savedSliders), savedSliders);
  await page.keyboard.press("Escape"); // slider → graph
  await page.keyboard.press("Escape"); // graph → cell
  // In a graph, kx means k·x (k has no value): the slider is k, not kx.
  await page.keyboard.press("Control+Enter");
  await page.keyboard.type("plot(kx^2");
  await page.keyboard.press("Enter");
  await waitIdle();
  await page.waitForTimeout(600);
  const kSliders = await page.$$eval(".entry", (els) => [...(els.find((e) => /\(kx\^2/.test(e.querySelector("math-field")?.value ?? ""))?.querySelectorAll(".graph-slider-name") ?? [])].map((n) => n.textContent));
  check("plot(kx²) gives a slider for k (kx is k·x in a graph)", kSliders.join(",") === "k", JSON.stringify(kSliders));
  // The axis is never guessed: hq runs over its own t; mq and nq inside it are sliders.
  await page.keyboard.press("Control+Enter");
  await page.keyboard.type("hq(t");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.type(":=mq*t+nq");
  await page.keyboard.press("Shift+Enter");
  await page.keyboard.type("plot(hq");
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("Enter");
  await waitIdle();
  await page.waitForTimeout(700);
  const hq = await page.$$eval(".entry", (els) => {
    const el = els.find((e) => /hq\\left\(t\\right\)/.test(e.querySelector("math-field")?.value ?? ""));
    return { sliders: el?.querySelectorAll(".graph-slider").length ?? 0, curve: (el?.querySelector(".graph-curve")?.getAttribute("d") ?? "").length > 20 };
  });
  check("names inside a plotted function get sliders too", hq.sliders === 2 && hq.curve, JSON.stringify(hq));
  await page.keyboard.type("plot(tq^2");
  await page.keyboard.press("Enter");
  await waitIdle();
  await page.waitForTimeout(200);
  check("an expression without x says so", /Use x, or define a function/.test((await resultOfCurrent()) ?? ""), await resultOfCurrent());
  await page.keyboard.press("Control+g");
  await page.keyboard.press("Control+Enter"); // a fresh tab
  await page.keyboard.type("y=pa*x^2");
  await page.waitForTimeout(900);
  const rowSliders = () => page.$$eval(".panel-row", (rows) => rows.map((r) => [...r.querySelectorAll(".panel-sliders .graph-slider")].map((l) => l.querySelector(".graph-slider-name").textContent + "=" + l.querySelector(".graph-slider-value").textContent)));
  check("a name without a value gets a slider inside its row (no new rows)", (await panelState()).rows.join("|") === "y=pa*x^2" && (await rowSliders())[0]?.join(",") === "pa=1" && (await panelState()).curves === 1, JSON.stringify([await panelState(), await rowSliders()]));
  const panelCurve = () => page.$eval(".graph-panel .graph-curve", (p) => p.getAttribute("d"));
  const panelCurveBefore = await panelCurve();
  await page.keyboard.press("Alt+ArrowDown");
  check("Alt+↓ goes to the row's slider", (await page.evaluate(() => document.activeElement?.getAttribute("aria-label"))) === "Slider for pa");
  await page.keyboard.press("ArrowRight");
  await page.waitForTimeout(600);
  check("→ moves it, as under a cell's graph", (await rowSliders())[0]?.join(",") === "pa=1.1", JSON.stringify(await rowSliders()));
  check("…and the curve follows the slider", (await panelCurve()) !== panelCurveBefore);
  await page.keyboard.press("Escape");
  check("Esc goes back to the row", (await panelState()).focus.includes("panel-input"), (await panelState()).focus);
  await page.waitForTimeout(600);
  const savedTabSliders = await page.evaluate(() => JSON.stringify(JSON.parse(localStorage.getItem("maddox.session") ?? "{}").graphs?.tabs?.map((t) => t.sliders)));
  check("the slider value is saved with the tab", /"pa":1.1/.test(savedTabSliders), savedTabSliders);
  await page.keyboard.press("Control+g");
};
