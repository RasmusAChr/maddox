// Notation: points and vectors, f′, %, piecewise functions, inequalities,
// units (Ctrl+U, →) and temperatures.

export default async ({ page, check, waitIdle, hints, current, setAndRun, typeAndRun, resultFor, resultOfCurrent, searchRun }) => {
  // Points: (a, b) typed at the keyboard is a point, shown with round
  // brackets, and computes like a vector; positions count from 1.
  await typeAndRun("Pa:=(1,3");
  check("a typed point shows as (1, 3)", (await resultFor("Pa\\coloneq")) === "\\left(1,\\,3\\right)", await resultFor("Pa\\coloneq"));
  await typeAndRun("Qa:=(3,8");
  await typeAndRun("Qa-Pa");
  check("Q − P computes like a vector", (await resultFor("Qa-Pa")) === "\\left(2,\\,5\\right)", await resultFor("Qa-Pa"));
  await typeAndRun("Qa[2");
  check("Qa[2] is the second coordinate", (await resultFor("Qa\\left\\lbrack2")) === "8", await resultFor("Qa\\left\\lbrack2"));
  await typeAndRun("(8,15");
  const pointApprox = await page.$$eval(".entry", (els) => els.find((e) => e.querySelector("math-field")?.value === "\\left(8,15\\right)")?.querySelector(".approx")?.textContent ?? null);
  check("a whole-number point has no stray decimal (not 8,15,6)", pointApprox === null, pointApprox);

  // More notation, typed: f′(x) is a derivative, % is hundredths, a
  // piecewise function comes from the template and is edited like a matrix.
  await page.keyboard.press("Control+Enter");
  await page.keyboard.type("fd(x");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.type(":=x^3");
  await page.keyboard.press("Enter");
  await waitIdle();
  await typeAndRun("fd'(2");
  check("f′(2) is the derivative at 2", (await resultFor("fd^{\\prime}")) === "12", await resultFor("fd^{\\prime}"));
  await typeAndRun("20%*150");
  check("20% of 150 is 30", (await resultFor("20\\%")) === "30", await resultFor("20\\%"));
  await page.keyboard.press("Control+Enter");
  await page.keyboard.type("gp(x");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.type(":=");
  await searchRun("piecewise");
  await page.keyboard.type("-x");
  await page.keyboard.press("Tab");
  await page.keyboard.type("x<0");
  await page.keyboard.press("Tab");
  await page.keyboard.type("x^2");
  await page.keyboard.press("Tab");
  await page.keyboard.type("otherwise");
  check("the hints explain a piecewise function", /Piecewise, 2 cases/.test(await hints()), await hints());
  await page.keyboard.press("Alt+ArrowDown");
  check("Alt+↓ adds a case", /Piecewise, 3 cases/.test(await hints()), await hints());
  await page.keyboard.press("Alt+Shift+ArrowDown");
  check("Alt+Shift+↓ deletes it again", /Piecewise, 2 cases/.test(await hints()), await hints());
  await page.keyboard.press("Enter");
  await waitIdle();
  await page.waitForTimeout(100);
  const piecewise = await resultFor("gp\\left");
  check("a piecewise function shows as a brace", piecewise?.includes("\\begin{cases}") && piecewise.includes("\\text{otherwise}"), piecewise);
  await typeAndRun("gp(-3");
  check("and evaluates by case", (await resultFor("gp\\left(-3")) === "3", await resultFor("gp\\left(-3"));
  await setAndRun(String.raw`\operatorname{solve}\left(x^2<4,x\right)`);
  check("an inequality answer reads -2 < x < 2", (await resultFor("x^2<4")) === "-2<x<2", await resultFor("x^2<4"));

  // Units: Ctrl+U types an upright unit (Space ends it), → converts, and
  // italic letters stay variables.
  await page.keyboard.press("Control+Enter");
  await page.keyboard.type("72");
  await page.keyboard.press("Control+u");
  check("Ctrl+U starts a unit", /Unit/.test(await hints()), await hints());
  await page.keyboard.type("km/h");
  await page.keyboard.press(" ");
  check("Space ends the unit", !/Unit/.test(await hints()), await hints());
  check("a unit is upright, / stays inline", (await current()).includes("72\\mathrm{km/h}"), await current());
  await page.keyboard.type("->");
  await page.keyboard.press("Control+u");
  await page.keyboard.type("m/s");
  await page.keyboard.press("Enter");
  await waitIdle();
  await page.waitForTimeout(100);
  check("72 km/h → m/s is 20 m/s", (await resultOfCurrent()) === "20\\,\\mathrm{m}/\\mathrm{s}", await resultOfCurrent());
  await page.keyboard.type("3");
  await page.keyboard.press("Control+u");
  await page.keyboard.type("kg");
  await page.keyboard.press(" ");
  await page.keyboard.type("*9.81");
  await page.keyboard.press("Control+u");
  await page.keyboard.type("m/s^2");
  await page.keyboard.press("Enter");
  await waitIdle();
  await page.waitForTimeout(100);
  check("3 kg · 9.81 m/s² is 29.43 N", (await resultOfCurrent()) === "29.43\\,\\mathrm{N}", await resultOfCurrent());
  await page.keyboard.type("2");
  await page.keyboard.press("Control+u");
  await page.keyboard.type("kg*m");
  await page.keyboard.press(" ");
  await page.keyboard.type("x");
  check("* is a · between units; letters after Space are variables", /^2\\mathrm\{kg\}\\cdot\\mathrm\{m\}x$/.test(await current()), await current());
  await page.keyboard.press("Control+Backspace");
  await page.keyboard.press("Control+a");
  await page.keyboard.press("Backspace");
  await page.keyboard.type("5");
  await page.keyboard.press("Control+u");
  await page.keyboard.type("xyz");
  await page.keyboard.press("Enter");
  await waitIdle();
  await page.waitForTimeout(100);
  check("an unknown unit is explained", (await resultOfCurrent()) === "Unknown unit: xyz", await resultOfCurrent());

  // Temperatures: ° inside unit mode makes °C / °F, → converts, and nothing
  // else is allowed with them.
  await page.keyboard.type("20");
  await page.keyboard.press("Control+u");
  await page.keyboard.type("°C");
  await page.keyboard.press(" ");
  await page.keyboard.type("->");
  await page.keyboard.press("Control+u");
  await page.keyboard.type("°F");
  await page.keyboard.press("Enter");
  await waitIdle();
  await page.waitForTimeout(100);
  check("20 °C → °F is 68 °F", (await resultOfCurrent()) === "68\\,^{\\circ}\\mathrm{F}", await resultOfCurrent());
  await page.keyboard.type("20");
  await page.keyboard.press("Control+u");
  await page.keyboard.type("°C");
  await page.keyboard.press(" ");
  await page.keyboard.type("+5");
  await page.keyboard.press("Control+u");
  await page.keyboard.type("°C");
  await page.keyboard.press("Enter");
  await waitIdle();
  await page.waitForTimeout(100);
  check("20 °C + 5 °C is explained", /Temperatures can only be converted/.test(await resultOfCurrent()), await resultOfCurrent());
};
