// The template sidebar (Ctrl+B), Ctrl+P search, deleting whole brackets,
// and clicks that never strand the keyboard.

export default async ({ page, check, waitIdle, entries, active }) => {
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
  const searchFor = async (q) => {
    await page.keyboard.press("Control+p");
    await page.waitForSelector("#search-dialog[open]");
    await page.keyboard.type(q);
    const first = await page.$eval('#search-dialog .catalog-item[aria-selected="true"] .catalog-name', (e) => e.textContent);
    return first;
  };
  check("search 'derivative'", (await searchFor("derivative")) === "Derivative");
  await page.keyboard.press("Escape");
  check("search 'def int'", (await searchFor("def int")) === "Definite integral");
  await page.keyboard.press("Escape");
  check("search finds app actions", (await searchFor("save as")) === "Save as…");
  await page.keyboard.press("Escape");
  check("search by command name", (await searchFor("eigenvals")) === "Eigenvalues");
  await page.keyboard.press("Enter");
  const inserted = (await entries()).at(-1);
  check("Enter inserts the result", inserted.includes("eigenvals"), inserted);

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
  const prepare = async (typed, left = 0) => {
    await page.evaluate(() => { const f = document.activeElement; f.value = "2+"; f.executeCommand("moveToMathfieldEnd"); });
    await page.keyboard.type(typed);
    for (let i = 0; i < left; i++) await page.keyboard.press("ArrowLeft");
  };
  await page.keyboard.press("Control+Enter");
  for (const key of ["Backspace", "Delete", "Control+Backspace", "Control+Delete"]) {
    await prepare("solve(");
    await page.keyboard.press(key);
    check(`empty solve() + ${key} deletes it`, (await field()) === "2+", await field());
  }
  await prepare("sin(x", 1);
  await page.keyboard.press("Backspace");
  check("Backspace at start of sin(x) keeps it, selected", (await field()).includes("\\sin\\left(x\\right)"), await field());
  await page.keyboard.press("Backspace");
  check("second Backspace deletes sin(x)", (await field()) === "2+", await field());
  await prepare("sin(x", 1);
  await page.keyboard.press("Control+Backspace");
  check("Ctrl+Backspace at start of sin(x) deletes it", (await field()) === "2+", await field());
  await prepare("sin(x");
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
};
