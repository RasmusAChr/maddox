// Evaluation on top of Giac's raw caseval(). Kept free of worker and DOM
// globals so tests can drive it against the real engine under Node.

export type EvalResult =
  | { ok: true; latex: string; approxLatex: string | null }
  | { ok: false; error: string };

export type Caseval = (input: string) => string;

/** How trigonometric functions read and return angles. */
export type AngleMode = "deg" | "rad";

import { ANS_VARIABLE, CALL_OR_PRODUCT, DEGREE_VARIABLE } from "./latex-to-giac";

// Every result is stored here so its LaTeX and decimal value can be read back
// without evaluating the input twice (which would repeat side effects).
const RESULT = "maddox_result";

export class GiacSession {
  private angle: AngleMode = "rad";

  constructor(
    private caseval: Caseval,
    /** Returns and clears what Giac printed since the last call. */
    private takePrinted: () => string[],
  ) {
    this.applyAngle();
  }

  setAngle(mode: AngleMode) {
    this.angle = mode;
    this.applyAngle();
  }

  // Giac's own switch (angle_radian) plus the value ° stands for. restart
  // resets Giac to radians, so this runs again after every reset.
  private applyAngle() {
    const rad = this.angle === "rad";
    this.caseval(`angle_radian:=${rad ? 1 : 0}`);
    this.caseval(`${DEGREE_VARIABLE}:=${rad ? "pi/180" : "1"}`);
    this.takePrinted();
  }

  evaluate(giac: string): EvalResult {
    // restart returns the names it cleared, RESULT among them, so storing
    // that list in RESULT is a "recursive definition" error.
    if (giac.trim() === "restart") {
      this.reset();
      return { ok: true, latex: "\\text{All variables cleared}", approxLatex: null };
    }
    giac = this.resolveCalls(giac);
    this.takePrinted();
    const raw = this.caseval(`${RESULT}:=(${giac})`);
    const error = findError(raw, this.takePrinted());
    if (error) return { ok: false, error };

    // regroup collects like terms (x+x is 2x), as Xcas does by default.
    const latex = cleanLatex(unquote(this.caseval(`latex(regroup(${RESULT}))`)));
    const approxText = this.caseval(`evalf(${RESULT})`);
    // "2.0" next to "3.5" in a decimal matrix is noise; show "2".
    const approxLatex = cleanLatex(unquote(this.caseval(`latex(evalf(${RESULT}))`))).replace(/(\d)\.0(?!\d)/g, "$1");
    this.caseval(`${ANS_VARIABLE}:=${RESULT}`);
    this.takePrinted();
    return { ok: true, latex, approxLatex: showApprox(latex, approxText) ? approxLatex : null };
  }

  /**
   * Decides each "name(" the converter could not: a call when the name is a
   * function (built in or defined by the user) or is being defined (f(x):=…),
   * otherwise a product, so 3x(4y+8z) multiplies.
   */
  private resolveCalls(giac: string): string {
    if (!giac.includes(CALL_OR_PRODUCT)) return giac;
    const isFunction = new Map<string, boolean>();
    const out = giac.replace(new RegExp(`([A-Za-z_][A-Za-z0-9_]*)${CALL_OR_PRODUCT}\\(`, "g"), (_m, name: string, offset: number) => {
      const open = offset + name.length + CALL_OR_PRODUCT.length;
      const close = matchingParen(giac, open);
      if (close >= 0 && /^\s*:=/.test(giac.slice(close + 1))) return `${name}(`;
      if (!isFunction.has(name)) isFunction.set(name, this.caseval(`type(${name})`) === "func");
      return isFunction.get(name) ? `${name}(` : `${name}*(`;
    });
    this.takePrinted();
    return out;
  }

  /** Forgets every variable and function the user defined. */
  reset() {
    this.caseval("restart");
    this.takePrinted();
    this.applyAngle();
  }
}

/** Index of the ")" matching the "(" at `open`, or -1. */
function matchingParen(s: string, open: number): number {
  let depth = 0;
  for (let i = open; i < s.length; i++) {
    if (s[i] === "(") depth++;
    else if (s[i] === ")" && --depth === 0) return i;
  }
  return -1;
}

function findError(raw: string, printed: string[]): string | null {
  if (raw.startsWith("GIAC_ERROR:")) {
    const m = raw.match(/Error:\s*(.+)$/s);
    return m ? m[1].trim() : raw.slice("GIAC_ERROR:".length).trim();
  }
  for (const line of printed) {
    const syntax = line.match(/syntax error.*?(?: at (.+?) in| at end of input)/);
    // The ")" closing our own wrapper means the input simply ended too early.
    const near = syntax?.[1]?.trim();
    if (syntax) return near && near !== ")" ? `Syntax error near “${near}”` : "Syntax error: the input is incomplete";
    const err = line.match(/Error:\s*(.+)/);
    if (err) return err[1].trim();
  }
  return null;
}

function unquote(s: string): string {
  return s.length >= 2 && s.startsWith('"') && s.endsWith('"') ? s.slice(1, -1) : s;
}

/** Makes Giac's LaTeX read like hand-written maths. */
export function cleanLatex(latex: string): string {
  return latex
    .trim()
    // x_1 comes back as \mathrm{x\_1}
    .replace(/\\mathrm\{([A-Za-z]+)\\_([A-Za-z0-9]+)\}/g, "$1_{$2}")
    .replace(/\\mathrm\{a(sin|cos|tan)h\}/g, "\\operatorname{ar$1h}")
    .replace(/\\mathrm\{a(sin|cos|tan)\}/g, "\\arc$1")
    // Matrices come as \left(\begin{array}{cc}...\end{array}\right); pmatrix
    // renders better and is what an entry uses, so a pasted result stays editable.
    .replace(/\\left\(\\begin\{array\}\{c*\}\s*([\s\S]*?)\s*\\end\{array\}\\right\)/g, "\\begin{pmatrix}$1\\end{pmatrix}")
    .replace(/e\^\{1\}/g, "e")
    // \frac{-1}{2} reads better as -\frac{1}{2}
    .replace(/\\frac\{-([^{}]+)\}/g, "-\\frac{$1}")
    .replace(/^\+\\infty/, "\\infty")
    .replace(/\\mathrm\{i\}/g, "i");
}

// Show a decimal next to an exact answer only when it adds something: the
// exact form is not already a decimal, and the approximation is purely numeric.
function showApprox(exactLatex: string, approxText: string): boolean {
  if (/\d\.\d|\d\.(?!\d)/.test(exactLatex)) return false;
  // evalf(10) is "10.0": a whole number gains nothing from a decimal.
  if (!/\d\.\d/.test(approxText.replace(/(\d)\.0\b/g, "$1"))) return false;
  return /^[\s\d.,+\-*/e^i[\]()]*$/.test(approxText.replace(/\binf(inity)?\b/g, ""));
}
