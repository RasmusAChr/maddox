// Runs the real Giac build under Node. Requires public/giac/giacwasm.js
// (fetched by `npm install`).
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runInThisContext } from "node:vm";
import { beforeAll, describe, expect, it } from "vitest";
import { cleanLatex, GiacSession } from "./giac-session";
import { latexToGiac } from "./latex-to-giac";

const giacPath = join(dirname(fileURLToPath(import.meta.url)), "../../public/giac/giacwasm.js");

let session: GiacSession;

beforeAll(async () => {
  const printed: string[] = [];
  const g = globalThis as any;
  await new Promise<void>((resolve) => {
    g.Module = {
      print: (s: string) => printed.push(s),
      printErr: () => {},
      onRuntimeInitialized: resolve,
    };
    g.require = createRequire(import.meta.url);
    g.__dirname = dirname(giacPath);
    runInThisContext(readFileSync(giacPath, "utf8"), { filename: giacPath });
  });
  session = new GiacSession(g.Module.cwrap("caseval", "string", ["string"]), () => printed.splice(0));
}, 60_000);

const run = (latex: string) => session.evaluate(latexToGiac(latex));

describe("GiacSession", () => {
  it.each([
    ["\\frac{1}{3}+\\frac{1}{6}", "\\frac{1}{2}", "0.5"],
    ["2+3", "5", null],
    ["\\sqrt{8}", "2\\cdot \\sqrt{2}", "2.82842712475"],
    ["\\begin{pmatrix}1&2\\\\3&4\\end{pmatrix}^{-1}", null, expect.stringContaining("1.5")],
    ["x+x", "2\\cdot x", null],
    // templates carried over from the legacy app
    ["\\operatorname{solve}\\left(\\left[x+y=3,x-y=1\\right],\\left[x,y\\right]\\right)", "\\begin{pmatrix}2 & 1\\end{pmatrix}", null],
    ["\\operatorname{approx}\\left(\\pi,10\\right)", "3.141592654", null],
    ["\\operatorname{subst}\\left(x^2+1,x=2\\right)", "5", null],
    ["\\det\\left(\\begin{pmatrix}1&2\\\\3&4\\end{pmatrix}\\right)", "-2", null],
    ["\\operatorname{factor}\\left(x^4-1\\right)", null, null],
    ["\\int_{0}^{1}x^{2}\\differentialD x", "\\frac{1}{3}", "0.333333333333"],
    ["\\frac{d}{dx}x\\sin x", null, null],
    ["\\lim_{x\\to 0}\\frac{\\sin x}{x}", "1", null],
    ["\\sum_{k=1}^{10}k", "55", null],
    ["2.5\\cdot 2", "5.0", null],
  ])("%s", (latex, exact, approx) => {
    const r = run(latex);
    expect(r.ok, JSON.stringify(r)).toBe(true);
    if (!r.ok) return;
    if (exact !== null) expect(r.latex).toBe(exact);
    expect(r.approxLatex).toEqual(approx);
  });

  it("keeps variables and functions between evaluations", () => {
    expect(run("a\\coloneq 7").ok).toBe(true);
    expect(run("f(x)\\coloneq x^2+1").ok).toBe(true);
    expect(run("f\\left(a\\right)")).toMatchObject({ ok: true, latex: "50" });
    session.reset();
    expect(run("a")).toMatchObject({ ok: true, latex: "a" });
    // the "restart" template does the same from an entry
    run("b\\coloneq 4");
    const restarted = run("\\operatorname{restart}");
    expect(restarted.ok, JSON.stringify(restarted)).toBe(true);
    expect(run("b")).toMatchObject({ ok: true, latex: "b" });
  });

  it("treats name(…) as a call only for functions", () => {
    // the reported bug: x is not a function, so this is 3·x·(4y+8z)
    expect(run("\\operatorname{expand}\\left(3x\\left(4y+8z\\right)\\right)")).toMatchObject({
      ok: true,
      latex: "12\\cdot x\\cdot y+24\\cdot x\\cdot z",
    });
    expect(run("h\\left(x\\right)\\coloneq x^2").ok).toBe(true); // a definition stays a call
    expect(run("h\\left(3\\right)")).toMatchObject({ ok: true, latex: "9" });
    expect(run("k\\coloneq 5").ok).toBe(true); // a number is not a function
    expect(run("k\\left(2\\right)")).toMatchObject({ ok: true, latex: "10" });
    expect(run("abs\\left(-3\\right)")).toMatchObject({ ok: true, latex: "3" }); // built-in typed as letters
    expect(run("\\operatorname{purge}\\left(h\\right)").ok).toBe(true);
    expect(run("\\operatorname{purge}\\left(k\\right)").ok).toBe(true);
  });

  it("makes the previous result available as ans", () => {
    run("\\frac{1}{3}");
    expect(run("3\\cdot ans")).toMatchObject({ ok: true, latex: "1" });
    expect(run("ans+1")).toMatchObject({ ok: true, latex: "2" });
  });

  it("renders subscripted names and matrices as LaTeX", () => {
    expect(run("x_1+x_1")).toMatchObject({ ok: true, latex: "2\\cdot x_{1}" });
    const m = run("\\begin{pmatrix}1&2\\\\3&4\\end{pmatrix}");
    expect(m.ok && m.latex).toBe("\\begin{pmatrix}1 & 2 \\\\\n3 & 4\\end{pmatrix}");
  });

  it("reports errors instead of results", () => {
    expect(session.evaluate("1+*2")).toMatchObject({ ok: false, error: expect.stringMatching(/Syntax error/) });
    expect(session.evaluate("1+")).toMatchObject({ ok: false, error: expect.stringMatching(/incomplete/) });
    expect(session.evaluate("det([[1,2],[3]])")).toMatchObject({ ok: false, error: expect.stringMatching(/Bad Argument/) });
  });
});

describe("angle mode", () => {
  it("degrees: trig reads and returns degrees, and survives a reset", () => {
    session.setAngle("deg");
    expect(run("\\sin\\left(30\\right)")).toMatchObject({ ok: true, latex: "\\frac{1}{2}" });
    expect(run("\\arcsin\\left(\\frac12\\right)")).toMatchObject({ ok: true, latex: "30" });
    expect(run("\\cos\\left(60^{\\circ}\\right)")).toMatchObject({ ok: true, latex: "\\frac{1}{2}" });
    session.reset();
    expect(run("\\tan\\left(45\\right)")).toMatchObject({ ok: true, latex: "1" });
  });

  it("radians: ° still means degrees", () => {
    session.setAngle("rad");
    expect(run("\\sin\\left(30^{\\circ}\\right)")).toMatchObject({ ok: true, latex: "\\frac{1}{2}" });
    expect(run("\\sin\\left(\\frac{\\pi}{6}\\right)")).toMatchObject({ ok: true, latex: "\\frac{1}{2}" });
    const r = run("\\sin\\left(30\\right)");
    expect(r.ok && r.latex).not.toBe("\\frac{1}{2}");
  });
});

describe("cleanLatex", () => {
  it.each([
    ["\\frac{-1}{2}", "-\\frac{1}{2}"],
    ["\\mathrm{x\\_1}", "x_{1}"],
    ["e^{1}", "e"],
    ["+\\infty ", "\\infty"],
    ["\\mathrm{atan}\\left(x\\right)", "\\arctan\\left(x\\right)"],
  ])("%s", (raw, clean) => expect(cleanLatex(raw)).toBe(clean));
});
