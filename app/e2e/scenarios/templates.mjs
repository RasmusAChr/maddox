// The template sidebar (Ctrl+B), Ctrl+P search, deleting whole brackets,
// and clicks that never strand the keyboard.

export default async ({ page, check, waitIdle, entries, active, current, setAndRun }) => {
  // Template sidebar: starts collapsed to an icon rail; Ctrl+B opens it;
  // each category shows its everyday templates with the rest behind "More".
  check("sidebar starts collapsed", await page.$eval("#templates", (el) => el.classList.contains("collapsed")));
  check("collapsed strip has a single button", (await page.$$("#templates .templates-rail button")).length === 1);
  await page.keyboard.press("Control+b");
  check("Ctrl+B opens the sidebar", await page.isVisible("#templates .templates-list"));
  await page.keyboard.press("Escape"); // back to the entry; the clicks below keep focus there
  const visibleTemplates = async () => page.$$eval("#templates .template", (els) => els.filter((e) => e.offsetParent).map((e) => e.querySelector(".template-name").textContent));
  let names = await visibleTemplates();
  check("advanced templates are tucked away", names.includes("Derivative") && !names.includes("Taylor series"), JSON.stringify(names));
  await page.click('#templates .tcat[data-id="calculus"] .tcat-more');
  names = await visibleTemplates();
  check("More reveals them", names.includes("Taylor series"), JSON.stringify(names));
  await page.click('#templates .tcat[data-id="solve"] .tcat-head');
  names = await visibleTemplates();
  check("a category collapses", !names.includes("Solve a system"), JSON.stringify(names));
  await page.click('#templates .tcat[data-id="solve"] .tcat-head');
  await page.keyboard.press("Control+Enter");
  await page.click('#templates .template:has(.template-name:text-is("Solve a system"))');
  await page.keyboard.type("x+y=3");
  await page.keyboard.press("Tab");
  await page.keyboard.type("x-y=1");
  await page.keyboard.press("Enter");
  await waitIdle();
  const sys = await page.$$eval(".entry .exact", (els) => els.map((e) => e.dataset.latex));
  check("clicking a template inserts it", sys.includes("x=2\\text{ and }y=1"), JSON.stringify(sys.slice(-3)));
  await page.click("#templates .templates-collapse");
  check("« collapses it again", await page.$eval("#templates", (el) => el.classList.contains("collapsed")));

  // Ctrl+P searches templates and app actions; all query words must match.
  // The first match for q, and what the page looked like (for a failure).
  const searchFor = async (q) => {
    await page.keyboard.press("Control+p");
    await page.waitForSelector("#search-dialog[open]");
    await page.keyboard.type(q);
    return page.evaluate(() => ({
      first: document.querySelector('#search-dialog .catalog-item[aria-selected="true"] .catalog-name')?.textContent ?? null,
      query: document.querySelector("#search-dialog input").value,
      focus: document.activeElement?.tagName + "." + document.activeElement?.className,
      open: [...document.querySelectorAll("dialog[open]")].map((d) => d.id),
    }));
  };
  let found = await searchFor("derivative");
  check("search 'derivative'", found.first === "Derivative", JSON.stringify(found));
  await page.keyboard.press("Escape");
  found = await searchFor("def int");
  check("search 'def int'", found.first === "Definite integral", JSON.stringify(found));
  await page.keyboard.press("Escape");
  found = await searchFor("save as");
  check("search finds app actions", found.first === "Save as…", JSON.stringify(found));
  await page.keyboard.press("Escape");
  found = await searchFor("eigenvals");
  check("search by command name", found.first === "Eigenvalues", JSON.stringify(found));
  await page.keyboard.press("Enter");
  const inserted = (await entries()).at(-1);
  check("Enter inserts the result", inserted.includes("eigenvals"), inserted);
  // Esc, then Ctrl+P at once: the first closing's late "close" event must
  // not pull focus out of the reopened search (it did in CI).
  await page.keyboard.press("Control+p");
  await page.waitForSelector("#search-dialog[open]");
  await page.evaluate(() => {
    const key = (target, init) => target.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init }));
    key(document.querySelector("#search-dialog input"), { key: "Escape" });
    key(window, { key: "p", ctrlKey: true });
  });
  await page.waitForTimeout(150);
  await page.keyboard.type("deriv");
  found = await page.evaluate(() => ({ query: document.querySelector("#search-dialog input").value, focus: document.activeElement?.tagName }));
  check("Esc then Ctrl+P at once: the reopened search keeps the keyboard", found.query === "deriv" && found.focus === "INPUT", JSON.stringify(found));
  await page.keyboard.press("Escape");

  // The sidebar's own search field filters templates; Enter inserts the best match.
  await page.keyboard.press("Control+Enter");
  await page.keyboard.press("Control+b");
  await page.click("#templates .templates-search input");
  await page.keyboard.type("taylor");
  names = await visibleTemplates();
  check("sidebar search filters", names.length === 1 && names[0] === "Taylor series", JSON.stringify(names));
  await page.keyboard.press("Enter");
  check("Enter inserts the match into the entry", (await entries()).at(-1).includes("taylor"), (await entries()).at(-1));
  names = await visibleTemplates();
  check("filter clears after inserting", names.length > 5, JSON.stringify(names));
  await page.keyboard.press("Control+b");

  // Deleting at the edge of brackets removes the whole call, never half of it.
  const field = () => page.evaluate(() => document.activeElement.value);
  // A function's name, then Tab (its suggestion), then what goes inside.
  const prepare = async (name, inside = "", left = 0) => {
    await page.evaluate(() => { const f = document.activeElement; f.value = "2+"; f.executeCommand("moveToMathfieldEnd"); });
    await page.keyboard.type(name);
    await page.keyboard.press("Tab");
    await page.keyboard.type(inside);
    for (let i = 0; i < left; i++) await page.keyboard.press("ArrowLeft");
  };
  await page.keyboard.press("Control+Enter");
  for (const key of ["Backspace", "Delete", "Control+Backspace", "Control+Delete"]) {
    await prepare("ln");
    await page.keyboard.press(key);
    check(`empty ln() + ${key} deletes it`, (await field()) === "2+", await field());
  }
  await prepare("sin", "x", 1);
  await page.keyboard.press("Backspace");
  check("Backspace at start of sin(x) keeps it, selected", (await field()).includes("\\sin\\left(x\\right)"), await field());
  await page.keyboard.press("Backspace");
  check("second Backspace deletes sin(x)", (await field()) === "2+", await field());
  await prepare("sin", "x", 1);
  await page.keyboard.press("Control+Backspace");
  check("Ctrl+Backspace at start of sin(x) deletes it", (await field()) === "2+", await field());
  await prepare("sin", "x");
  await page.keyboard.press("Control+Delete");
  check("Ctrl+Delete at end of sin(x) deletes it", (await field()) === "2+", await field());

  // Templates without the mouse: Ctrl+B focuses the search field, ↑/↓
  // move the highlighted selection, Enter inserts, Esc goes back.
  await page.keyboard.press("Control+Enter");
  const selectedName = () => page.$eval("#templates .selected", (el) => el.querySelector(".template-name")?.textContent ?? el.textContent).catch(() => null);
  await page.keyboard.press("Control+b");
  check("Ctrl+B focuses the template search", (await active()).startsWith("INPUT"), await active());
  await page.keyboard.press("ArrowDown");
  check("↓ selects the first template", (await selectedName()) === "Fraction", await selectedName());
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  check("↓↓ moves the selection", (await selectedName()) === "Square root", await selectedName());
  await page.keyboard.press("ArrowUp");
  check("↑ moves it back", (await selectedName()) === "Power", await selectedName());
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  check("Enter inserts the selected template", (await entries()).at(-1).includes("\\sqrt"), (await entries()).at(-1));
  check("focus is back in the entry", (await active()).startsWith("MATH-FIELD"), await active());
  await page.keyboard.press("Control+b"); // close
  await page.keyboard.press("Control+b"); // open again
  await page.keyboard.type("deriv");
  check("typing selects the best match", (await selectedName()) === "Derivative", await selectedName());
  await page.keyboard.press("ArrowDown");
  // Integral matches too ("Antiderivative"), and sits right below.
  check("↓ moves through the matches", (await selectedName()) === "Integral", await selectedName());
  await page.keyboard.press("Escape");
  check("Esc returns to the entry", (await active()).startsWith("MATH-FIELD"), await active());
  check("Esc clears the filter", (await page.$eval("#templates .templates-search input", (i) => i.value)) === "");
  await page.keyboard.press("Control+b"); // close (focus is in the entry)
  await page.keyboard.press("Control+b"); // open
  await page.keyboard.press("ArrowUp");
  check("↑ from the field selects the last item", (await page.$eval("#templates .selected", (el) => el.classList.contains("tcat-more"))) === true);
  await page.keyboard.press("Enter");
  check("Enter on More expands it", await page.$eval('#templates .tcat[data-id="units"]', (el) => el.classList.contains("show-more")));
  await page.keyboard.press("Control+b");
  check("Ctrl+B in the field closes and returns to the entry", (await active()).startsWith("MATH-FIELD") && (await page.$eval("#templates", (el) => el.classList.contains("collapsed"))), await active());

  // Clicking empty space never strands the keyboard.
  const where = () => page.evaluate(() => {
    const a = document.activeElement;
    const entries = [...document.querySelectorAll(".entry")];
    return { tag: a?.tagName, index: entries.indexOf(a?.closest(".entry")) };
  });
  const nb = await page.$eval("#notebook", (el) => { const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, bottom: r.bottom }; });
  await page.mouse.click(nb.x, nb.bottom - 20); // empty space below the last entry
  let at = await where();
  const count = (await entries()).length;
  check("click below the entries focuses the last one", at.tag === "MATH-FIELD" && at.index === count - 1, JSON.stringify(at));
  await page.keyboard.type("1+1");
  check("and typing goes there", (await entries()).at(-1).endsWith("1+1"), (await entries()).at(-1));
  const box = await page.$eval(".entry:nth-child(2)", (el) => { el.scrollIntoView({ block: "center" }); const r = el.getBoundingClientRect(); return { x: r.right - 8, y: r.top + 4 }; });
  await page.mouse.click(box.x, box.y); // padding of the second entry
  at = await where();
  check("click on an entry's empty area focuses it", at.tag === "MATH-FIELD" && at.index === 1, JSON.stringify(at));
  const bar = await page.$eval(".statusbar", (el) => { const r = el.getBoundingClientRect(); return { x: r.right - 40, y: r.top + r.height / 2 }; });
  await page.mouse.click(bar.x, bar.y); // empty part of the status bar
  at = await where();
  check("click on the status bar keeps focus", at.tag === "MATH-FIELD" && at.index === 1, JSON.stringify(at));
  await page.keyboard.press("Control+b");
  const side = await page.$eval("#templates .templates-list", (el) => { const r = el.getBoundingClientRect(); return { x: r.left + 20, y: r.bottom - 5 }; });
  await page.mouse.click(side.x, side.y); // empty sidebar space
  at = await where();
  check("click on empty sidebar space keeps the search field", at.tag === "INPUT", JSON.stringify(at));
  await page.keyboard.press("ArrowDown");
  check("so ↓ still selects", (await page.$$("#templates .selected")).length === 1);
  await page.keyboard.press("Control+b");
  await page.waitForTimeout(150);

  // Suggestions while typing a name: grey text after two letters, Tab takes
  // it. Nothing converts by itself, so names that start with a function's
  // name can be typed.
  // The grey text is drawn on the next frame.
  const ghost = async () => {
    await page.waitForTimeout(50);
    return page.evaluate(() => {
      const g = document.querySelector(".suggestion-ghost");
      return g && !g.hidden ? g.textContent : null;
    });
  };
  await page.keyboard.press("Control+Enter");
  await page.keyboard.type("s");
  check("one letter shows no suggestion", (await ghost()) === null, await ghost());
  await page.keyboard.type("o");
  check("so suggests solve(…, x) in grey", (await ghost()) === "lve(…, x)", await ghost());
  check("and the letters stay letters", (await current()) === "so", await current());
  await page.keyboard.press("Tab");
  check("Tab takes it: solve(□, x)", (await current()) === "\\operatorname{solve}\\left(\\placeholder{},x\\right)", await current());
  await page.keyboard.press("Control+z");
  await page.waitForTimeout(80);
  check("Ctrl+Z goes back to the letters", (await current()) === "so", await current());
  await page.keyboard.type("lution");
  check("solution: no name starts so, no suggestion", (await ghost()) === null, await ghost());
  await page.keyboard.type("1:=12");
  await page.keyboard.press("Enter");
  await waitIdle();
  await page.waitForTimeout(100);
  await page.keyboard.press("Control+Enter");
  await page.keyboard.type("sol");
  check("the notebook's own names come first", (await ghost()) === "ution1", await ghost());
  await page.keyboard.press("Tab");
  check("Tab completes the name", (await current()) === "solution1", await current());
  await page.keyboard.press("Control+Enter");
  await page.keyboard.type("determinant");
  check("determinant stays one name (no det)", (await current()) === "determinant", await current());
  await page.keyboard.press("Control+Enter");
  await page.keyboard.type("th");
  check("th suggests theta, showing θ", (await ghost()) === "eta θ", await ghost());
  await page.keyboard.press("Escape");
  check("Esc hides the suggestion", (await ghost()) === null, await ghost());
  await page.keyboard.type("e");
  check("the next letter brings it back", (await ghost()) === "ta θ", await ghost());
  await page.keyboard.press("Tab");
  check("Tab gives θ", (await current()) === "\\theta", await current());
  await page.keyboard.press("Tab");
  check("Tab with no suggestion does what it did", (await current()) === "\\theta", await current());
};
