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
    ["\\sqrt{8}", "2\\cdot \\sqrt{2}", "2.82843"],
    ["\\begin{pmatrix}1&2\\\\3&4\\end{pmatrix}^{-1}", null, expect.stringContaining("1.5")],
    ["x+x", "2\\cdot x", null],
    // templates carried over from the legacy app
    ["\\operatorname{solve}\\left(\\left[x+y=3,x-y=1\\right],\\left[x,y\\right]\\right)", "x=2\\text{ and }y=1", null],
    ["\\operatorname{approx}\\left(\\pi,10\\right)", "3.141592654", null],
    ["\\operatorname{subst}\\left(x^2+1,x=2\\right)", "5", null],
    ["\\det\\left(\\begin{pmatrix}1&2\\\\3&4\\end{pmatrix}\\right)", "-2", null],
    ["\\operatorname{factor}\\left(x^4-1\\right)", null, null],
    ["\\int_{0}^{1}x^{2}\\differentialD x", "\\frac{1}{3}", "0.333333"],
    ["\\frac{d}{dx}x\\sin x", null, null],
    ["\\lim_{x\\to 0}\\frac{\\sin x}{x}", "1", null],
    ["\\sum_{k=1}^{10}k", "55", null],
    ["2.5\\cdot 2", "5", null],
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
    expect(session.evaluate("det([[1,2],[3]])")).toMatchObject({ ok: false, error: "det needs a matrix." });
  });
});

describe("readable answers", () => {
  const exact = (latex: string) => {
    const r = run(latex);
    return r.ok ? r.latex : `ERROR: ${r.error}`;
  };

  it("textbook solve answers (the default)", () => {
    session.configure({ angle: "rad", solveStyle: "textbook" });
    expect(exact("\\operatorname{solve}\\left(x^2=2,x\\right)")).toBe("x=-\\sqrt{2}\\text{ or }x=\\sqrt{2}");
    expect(exact("\\operatorname{solve}\\left(2x=4,x\\right)")).toBe("x=2");
    expect(exact("\\operatorname{solve}\\left(x^2=-1,x\\right)")).toBe("\\text{No solution}");
    expect(exact("\\operatorname{solve}\\left(x^2>4,x\\right)")).toBe("x<-2\\text{ or }x>2");
    expect(exact("\\operatorname{solve}\\left(x^2<4,x\\right)")).toBe("x>-2\\text{ and }x<2");
    expect(exact("\\operatorname{solve}\\left(\\left[x^2+y^2=1,x=y\\right],\\left[x,y\\right]\\right)")).toBe(
      "\\left(x=\\frac{\\sqrt{2}}{2}\\text{ and }y=\\frac{\\sqrt{2}}{2}\\right)\\text{ or }\\left(x=-\\frac{\\sqrt{2}}{2}\\text{ and }y=-\\frac{\\sqrt{2}}{2}\\right)",
    );
  });

  it("set-style solve answers (the option)", () => {
    session.configure({ solveStyle: "sets" });
    expect(exact("\\operatorname{solve}\\left(x^2=2,x\\right)")).toBe("x\\in\\left\\{-\\sqrt{2},\\,\\sqrt{2}\\right\\}");
    expect(exact("\\operatorname{solve}\\left(x^2=-1,x\\right)")).toBe("\\emptyset");
    expect(exact("\\operatorname{solve}\\left(\\left[x+y=3,x-y=1\\right],\\left[x,y\\right]\\right)")).toBe(
      "\\left(x,\\,y\\right)=\\left(2,\\,1\\right)",
    );
    session.configure({ solveStyle: "textbook" });
  });

  it("π and roots read as written: π/6, √2/2", () => {
    session.configure({ angle: "rad" });
    expect(exact("\\operatorname{solve}\\left(\\sin\\left(x\\right)=\\frac12,x\\right)")).toBe("x=\\frac{\\pi}{6}\\text{ or }x=\\frac{5\\pi}{6}");
    expect(exact("\\frac{\\sqrt{2}}{2}")).toBe("\\frac{\\sqrt{2}}{2}");
  });

  it("decimals: 6 significant digits, powers of ten, but approx(…, n) keeps n", () => {
    expect(run("9\\pi")).toMatchObject({ ok: true, approxLatex: "28.2743" });
    expect(exact("\\frac{1.0}{7000000}")).toBe("1.42857\\cdot 10^{-7}");
    expect(exact("\\operatorname{approx}\\left(\\pi,12\\right)")).toBe("3.14159265359");
  });

  it("errors in plain words, including Giac's silently wrong answers", () => {
    const error = (giac: string) => {
      const r = session.evaluate(giac);
      return r.ok ? `OK: ${r.latex}` : r.error;
    };
    expect(error("inv([[1,2],[2,4]])")).toBe("This matrix can't be inverted: its determinant is 0.");
    expect(error("inv([[1,2,3],[4,5,6]])")).toBe("inv needs a square matrix.");
    expect(error("det([[1,2,3],[4,5,6]])")).toBe("det needs a square matrix.");
    expect(error("eigenvals([[1,2,3],[4,5,6]])")).toBe("eigenvals needs a square matrix.");
    expect(error("[[1,2],[3,4]]*[[1,2,3]]")).toBe("The sizes don't fit together: check the number of rows and columns.");
    expect(error("ifactor(2.5)")).toBe("ifactor needs whole numbers.");
    expect(error("isprime(2.5)")).toBe("isprime needs whole numbers.");
    expect(error("rref(5)")).toBe("rref needs a matrix.");
    expect(error("[[1,2,3],[4,5,6]]^(-1)")).toBe("Powers and inverses need a square matrix.");
    expect(error("[[1,2,3],[4,5,6]]^2")).toBe("Powers and inverses need a square matrix.");
    expect(error("[[1,2],[3,4]]^(-1)")).toBe("OK: \\begin{pmatrix}-2 & 1 \\\\\n\\frac{3}{2} & -\\frac{1}{2}\\end{pmatrix}");
  });
});

describe("answer modes and digits", () => {
  it("auto shows both, exact only the exact form, approx only decimals", () => {
    session.configure({ answerMode: "auto", digits: 6 });
    expect(run("\\frac{1}{3}")).toMatchObject({ ok: true, latex: "\\frac{1}{3}", approxLatex: "0.333333" });
    session.configure({ answerMode: "exact" });
    expect(run("\\frac{1}{3}")).toMatchObject({ ok: true, latex: "\\frac{1}{3}", approxLatex: null });
    session.configure({ answerMode: "approx" });
    expect(run("\\frac{1}{3}")).toMatchObject({ ok: true, latex: "0.333333", approxLatex: null });
    expect(run("\\operatorname{solve}\\left(x^2=2,x\\right)")).toMatchObject({ ok: true, latex: "x=-1.41421\\text{ or }x=1.41421" });
    expect(run("x+1")).toMatchObject({ ok: true, latex: "x+1", approxLatex: null });
    session.configure({ answerMode: "auto" });
  });

  it("digits follow the setting", () => {
    session.configure({ digits: 10 });
    expect(run("\\pi")).toMatchObject({ ok: true, approxLatex: "3.141592654" });
    session.configure({ digits: 6 });
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

describe("points and vectors", () => {
  it("(a, b, …) is a point: shown with round brackets, computed like a vector", () => {
    session.reset();
    expect(run("P\\coloneq\\left(1,3\\right)")).toMatchObject({ ok: true, latex: "\\left(1,\\,3\\right)", approxLatex: null });
    run("Q\\coloneq\\left(3,8\\right)");
    expect(run("Q-P")).toMatchObject({ ok: true, latex: "\\left(2,\\,5\\right)" });
    expect(run("2P")).toMatchObject({ ok: true, latex: "\\left(2,\\,6\\right)" });
    expect(run("\\frac{P+Q}{2}")).toMatchObject({ ok: true, latex: "\\left(2,\\,\\frac{11}{2}\\right)", approxLatex: "\\left(2,\\,5.5\\right)" });
    expect(run("\\left|Q-P\\right|")).toMatchObject({ ok: true, latex: "\\sqrt{29}" });
    expect(run("P\\cdot Q")).toMatchObject({ ok: true, latex: "27" });
    expect(run("\\left(1,2,3,4\\right)+\\left(1,1,1,1\\right)")).toMatchObject({ ok: true, latex: "\\left(2,\\,3,\\,4,\\,5\\right)" });
  });

  it("decimals in a point are rounded per coordinate (not 8,15,6)", () => {
    expect(run("\\left(8,15\\right)")).toMatchObject({ ok: true, latex: "\\left(8,\\,15\\right)", approxLatex: null });
    expect(run("\\left(1.5,\\frac{1}{3}\\right)")).toMatchObject({ ok: true, latex: "\\left(1.5,\\,0.333333\\right)" });
  });

  it("a number before a point multiplies it; a function is called", () => {
    run("k\\coloneq3");
    expect(run("k\\left(1,2\\right)")).toMatchObject({ ok: true, latex: "\\left(3,\\,6\\right)" });
    run("g\\left(a,b\\right)\\coloneq a+b");
    expect(run("g\\left(1,2\\right)")).toMatchObject({ ok: true, latex: "3" });
  });

  it("lists of points stay lists; lists and matrices are unchanged", () => {
    expect(run("\\left[\\left(1,3\\right),\\left(3,8\\right)\\right]")).toMatchObject({
      ok: true,
      latex: "\\left[\\left(1,\\,3\\right),\\,\\left(3,\\,8\\right)\\right]",
    });
    expect(run("\\left[1,3\\right]")).toMatchObject({ ok: true, latex: "[1,3]" });
    const m = run("\\begin{pmatrix}1&3\\\\3&8\\end{pmatrix}");
    expect(m.ok && m.latex).toContain("pmatrix");
  });

  it("matrix times point; a point or list with a column matrix gives a column", () => {
    run("X\\coloneq\\begin{pmatrix}1&1\\\\1&3\\end{pmatrix}");
    expect(run("X\\cdot\\left(2,1\\right)")).toMatchObject({ ok: true, latex: "\\left(3,\\,5\\right)" });
    // A list written by the user stays a list.
    expect(run("X\\cdot\\left[2,1\\right]")).toMatchObject({ ok: true, latex: "[3,5]" });
    const col = run("\\left(1,3\\right)+\\begin{pmatrix}1\\\\3\\end{pmatrix}");
    expect(col.ok && col.latex.replace(/\s/g, "")).toBe("\\begin{pmatrix}2\\\\6\\end{pmatrix}");
    run("P\\coloneq\\left(1,3\\right)");
    const named = run("P-\\begin{pmatrix}1\\\\3\\end{pmatrix}");
    expect(named.ok && named.latex.replace(/\s/g, "")).toBe("\\begin{pmatrix}0\\\\0\\end{pmatrix}");
    const list = run("\\left[1,3\\right]+\\begin{pmatrix}1\\\\3\\end{pmatrix}");
    expect(list.ok && list.latex.replace(/\s/g, "")).toBe("\\begin{pmatrix}2\\\\6\\end{pmatrix}");
  });

  it("positions count from 1", () => {
    run("P\\coloneq\\left(1,3\\right)");
    expect(run("P\\left[1\\right]")).toMatchObject({ ok: true, latex: "1" });
    expect(run("P\\left[2\\right]")).toMatchObject({ ok: true, latex: "3" });
    run("M\\coloneq\\begin{pmatrix}1&2\\\\3&4\\end{pmatrix}");
    expect(run("M\\left[2,1\\right]")).toMatchObject({ ok: true, latex: "3" });
  });

  it("points survive a reset (the helpers are defined again)", () => {
    session.reset();
    expect(run("\\left(1,3\\right)")).toMatchObject({ ok: true, latex: "\\left(1,\\,3\\right)" });
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
