// Evaluation on top of Giac's raw caseval(). Kept free of worker and DOM
// globals so tests can drive it against the real engine under Node.

export type EvalResult =
  | { ok: true; latex: string; approxLatex: string | null }
  | { ok: false; error: string };

export type Caseval = (input: string) => string;

/** How trigonometric functions read and return angles. */
export type AngleMode = "deg" | "rad";

/** How solve answers read: "x = 2 or x = 3" (textbook) or "x ∈ {2, 3}" (sets). */
export type SolveStyle = "textbook" | "sets";

export type SessionOptions = {
  angle: AngleMode;
  solveStyle: SolveStyle;
  /** Significant digits for decimal answers. */
  digits: number;
};

import { ANS_VARIABLE, CALL_OR_PRODUCT, DEGREE_VARIABLE } from "./latex-to-giac";

// Every result is stored here so its LaTeX and decimal value can be read back
// without evaluating the input twice (which would repeat side effects).
const RESULT = "maddox_result";

const OR = "\\text{ or }";
const AND = "\\text{ and }";

export class GiacSession {
  private options: SessionOptions = { angle: "rad", solveStyle: "textbook", digits: 6 };

  constructor(
    private caseval: Caseval,
    /** Returns and clears what Giac printed since the last call. */
    private takePrinted: () => string[],
  ) {
    this.applyAngle();
  }

  configure(options: Partial<SessionOptions>) {
    Object.assign(this.options, options);
    if (options.angle !== undefined) this.applyAngle();
  }

  setAngle(mode: AngleMode) {
    this.configure({ angle: mode });
  }

  // Giac's own switch (angle_radian) plus the value ° stands for. restart
  // resets Giac to radians, so this runs again after every reset.
  private applyAngle() {
    const rad = this.options.angle === "rad";
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
    const notSquare = this.squareCheck(giac);
    if (notSquare) return { ok: false, error: notSquare };
    this.takePrinted();
    const raw = this.caseval(`${RESULT}:=(${giac})`);
    const error = findError(raw, this.takePrinted(), giac);
    if (error) return { ok: false, error };

    // approx(…, 20) asks for its own number of digits: don't round that.
    let latex = this.exactLatex(RESULT, !askedForDigits(giac));
    const approxText = this.caseval(`evalf(${RESULT})`);
    let approxLatex = this.decimalLatex(RESULT);
    const solve = solveCall(giac);
    if (solve) {
      const answer = this.formatSolve(solve.vars, false);
      if (answer !== null) {
        latex = answer;
        approxLatex = this.formatSolve(solve.vars, true) ?? approxLatex;
      }
    }
    this.caseval(`${ANS_VARIABLE}:=${RESULT}`);
    this.takePrinted();
    return { ok: true, latex, approxLatex: showApprox(latex, approxText) ? approxLatex : null };
  }

  /**
   * inv, det and the eigen functions of a non-square matrix: Giac answers
   * anyway (inv returns element-wise reciprocals, without even a warning),
   * so check the shape first.
   */
  private squareCheck(giac: string): string | null {
    const m = giac.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\(/);
    if (!m || !NEEDS_SQUARE.has(m[1])) return null;
    const open = m[0].length - 1;
    const end = giac.trimEnd().length - 1;
    if (matchingParen(giac, open) !== end) return null;
    const args = splitTopLevel(giac.slice(open + 1, end));
    if (args.length !== 1) return null;
    const dims = this.caseval(`[rowdim(${args[0]}),coldim(${args[0]})]`).match(/^\[(\d+),(\d+)\]$/);
    this.takePrinted();
    return dims && dims[1] !== dims[2] ? `${m[1]} needs a square matrix.` : null;
  }

  /** Exact form; a result that already holds decimals is shown rounded like any decimal. */
  private exactLatex(expr: string, roundDecimals = true): string {
    // regroup collects like terms (x+x is 2x), as Xcas does by default.
    const latex = cleanLatex(unquote(this.caseval(`latex(regroup(${expr}))`)));
    return roundDecimals && /\d\.\d/.test(latex) ? this.decimalLatex(expr) : latex;
  }

  private decimalLatex(expr: string): string {
    const latex = cleanLatex(unquote(this.caseval(`latex(evalf(${expr},${this.options.digits}))`)));
    // "2.0" next to "3.5" in a decimal matrix is noise; show "2".
    return latex.replace(/(\d)\.0(?!\d)/g, "$1");
  }

  /**
   * A solve result (a list of values, of conditions, or of rows for a
   * system) as "x = 2 or x = 3" / "x ∈ {2, 3}". Null when the result is not
   * shaped like that, and it is then shown as Giac gives it.
   */
  private formatSolve(vars: string[], numeric: boolean): string | null {
    const n = Number(this.caseval(`size(${RESULT})`));
    if (!Number.isInteger(n) || n < 0) return null;
    const textbook = this.options.solveStyle === "textbook";
    if (n === 0) return textbook ? "\\text{No solution}" : "\\emptyset";
    const show = (expr: string) => (numeric ? this.decimalLatex(expr) : this.exactLatex(expr));
    const names = vars.map((v) => cleanLatex(unquote(this.caseval(`latex(${v})`))));
    const item = (k: number) => `${RESULT}[${k}]`;

    if (names.length === 1) {
      const [x] = names;
      const values: string[] = [];
      const conditions: string[] = [];
      for (let k = 0; k < n; k++) {
        const text = this.caseval(`string(${item(k)})`);
        if (/[<>]|!=|\band\b|\bor\b/.test(text)) conditions.push(conditionLatex(show(item(k))));
        else values.push(show(item(k)));
      }
      if (textbook) return [...values.map((v) => `${x}=${v}`), ...conditions].join(OR);
      const set = values.length ? `${x}\\in\\left\\{${values.join(",\\,")}\\right\\}` : "";
      return [set, ...conditions].filter(Boolean).join("\\lor ");
    }

    // A system: one row of values per solution (fsolve gives a single flat row).
    const rows: string[][] = [];
    if (this.caseval(`type(${item(0)})`) === "vector") {
      for (let k = 0; k < n; k++) {
        if (Number(this.caseval(`size(${item(k)})`)) !== names.length) return null;
        rows.push(names.map((_, j) => show(`${item(k)}[${j}]`)));
      }
    } else {
      if (n !== names.length) return null;
      rows.push(names.map((_, j) => show(item(j))));
    }
    if (textbook) {
      const each = rows.map((row) => names.map((x, j) => `${x}=${row[j]}`).join(AND));
      return each.length === 1 ? each[0] : each.map((r) => `\\left(${r}\\right)`).join(OR);
    }
    const tuple = (parts: string[]) => `\\left(${parts.join(",\\,")}\\right)`;
    return rows.length === 1
      ? `${tuple(names)}=${tuple(rows[0])}`
      : `${tuple(names)}\\in\\left\\{${rows.map(tuple).join(",\\,")}\\right\\}`;
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

/** Splits on commas that are not inside (), [] or {}. */
function splitTopLevel(s: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if ("([{".includes(c)) depth++;
    else if (")]}".includes(c)) depth--;
    else if (c === "," && depth === 0) {
      parts.push(s.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(s.slice(start));
  return parts;
}

/** The variables of an input that is exactly solve(…, x), csolve, or fsolve (x=guess allowed). */
export function solveCall(giac: string): { vars: string[] } | null {
  const m = giac.match(/^\s*(?:c?solve|fsolve)\(/);
  if (!m) return null;
  const open = m[0].length - 1;
  if (matchingParen(giac, open) !== giac.trimEnd().length - 1) return null;
  const args = splitTopLevel(giac.slice(open + 1, giac.trimEnd().length - 1));
  if (args.length < 2) return null;
  const v = args[1].trim();
  const list = v.startsWith("[") && v.endsWith("]") ? splitTopLevel(v.slice(1, -1)) : [v];
  const vars = list.map((s) => s.split("=")[0].trim());
  return vars.every((s) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(s)) ? { vars } : null;
}

/** True for approx(…, n) or evalf(…, n): the user chose the number of digits. */
function askedForDigits(giac: string): boolean {
  const m = giac.match(/^\s*(?:approx|evalf)\(/);
  if (!m) return false;
  const open = m[0].length - 1;
  const end = giac.trimEnd().length - 1;
  return matchingParen(giac, open) === end && splitTopLevel(giac.slice(open + 1, end)).length === 2;
}

/** Giac writes x^2<4 as (x>-2)\mbox{ and }(x<2). */
function conditionLatex(latex: string): string {
  return latex.replace(/\\mbox\{ and \}/g, AND).replace(/\\mbox\{ or \}/g, OR).replace(/\(([^()]*(?:<|>|\\leq|\\geq)[^()]*)\)/g, "$1");
}

// Functions whose "bad argument" errors mean the same thing every time.
const NEEDS_WHOLE_NUMBERS = new Set(["ifactor", "isprime", "nextprime", "prevprime", "gcd", "lcm", "irem", "iquo", "comb", "perm", "factorial"]);
const NEEDS_MATRIX = new Set(["det", "inv", "rref", "rank", "transpose", "eigenvals", "eigenvects", "ker", "trace"]);
const NEEDS_SQUARE = new Set(["det", "inv", "eigenvals", "eigenvects", "trace"]);

/**
 * An error in words a student understands. Giac's own messages are terse
 * ("Bad Argument Value") or hide the useful part; a few Giac answers are
 * silently wrong and only a printed warning says so (inv of a non-square
 * matrix returns element-wise reciprocals), so those become errors too.
 */
function findError(raw: string, printed: string[], giac: string): string | null {
  const fn = giac.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\(/)?.[1];
  const named = (text: string) => (fn ? `${fn} ${text}` : `This ${text}`);
  const friendly = (text: string): string | null => {
    if (/Not invertible/i.test(text)) return "This matrix can't be inverted: its determinant is 0.";
    if (/non-square/i.test(text)) return named("needs a square matrix.");
    if (/\^ is ambiguous on non square/i.test(text)) return "Powers and inverses need a square matrix.";
    if (/Invalid dimension/i.test(text)) {
      return fn && NEEDS_SQUARE.has(fn) ? named("needs a square matrix.") : "The sizes don't fit together: check the number of rows and columns.";
    }
    if (/Bad Argument (Type|Value)/i.test(text)) {
      if (fn && NEEDS_WHOLE_NUMBERS.has(fn)) return named("needs whole numbers.");
      if (fn && NEEDS_MATRIX.has(fn)) return named("needs a matrix.");
      return fn ? `${fn} can't use this input.` : "This input can't be used here.";
    }
    return null;
  };

  if (raw.startsWith("GIAC_ERROR:")) {
    const text = raw.slice("GIAC_ERROR:".length);
    return friendly(text) ?? text.match(/Error:\s*(.+)$/s)?.[1].trim() ?? text.trim();
  }
  for (const line of printed) {
    const syntax = line.match(/syntax error.*?(?: at (.+?) in| at end of input)/);
    // The ")" closing our own wrapper means the input simply ended too early.
    const near = syntax?.[1]?.trim();
    if (syntax) return near && near !== ")" ? `Syntax error near “${near}”` : "Syntax error: the input is incomplete";
    if (/Warning: non-square matrix|\^ is ambiguous on non square/i.test(line)) return friendly(line);
    const err = line.match(/Error:\s*(.+)/);
    if (err) return friendly(line) ?? err[1].trim();
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
    // \frac{1}{6}\cdot\pi reads better as \frac{\pi}{6}; same for a root
    .replace(/\\frac\{(\d+)\}\{(\d+)\}\s*\\cdot\s*(\\pi|\\sqrt\{[^{}]*\})\s?/g, (_m, a: string, b: string, x: string) => `\\frac{${a === "1" ? "" : a}${x}}{${b}}`)
    // 1.42857e-07 as 1.42857·10⁻⁷
    .replace(/(\d+(?:\.\d+)?)e([+-]?)0*(\d+)/g, (_m, mantissa: string, sign: string, exp: string) => `${mantissa}\\cdot 10^{${sign === "-" ? "-" : ""}${exp}}`)
    .replace(/^\+\\infty/, "\\infty")
    .replace(/\\mathrm\{i\}/g, "i");
}

// Show a decimal next to an exact answer only when it adds something: the
// exact form is not already a decimal, and the approximation is purely numeric.
function showApprox(exactLatex: string, approxText: string): boolean {
  if (/\d\.\d|\d\.(?!\d)/.test(exactLatex)) return false;
  const text = approxText.replace(/^list/, "");
  // evalf(10) is "10.0": a whole number gains nothing from a decimal.
  if (!/\d\.\d/.test(text.replace(/(\d)\.0\b/g, "$1"))) return false;
  return /^[\s\d.,+\-*/e^i[\]()]*$/.test(text.replace(/\binf(inity)?\b/g, ""));
}
