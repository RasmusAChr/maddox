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

/**
 * Which forms an answer shows: auto = exact, plus a decimal when it adds
 * something; exact = exact only; approx = decimals only.
 */
export type AnswerMode = "auto" | "exact" | "approx";

export type SessionOptions = {
  angle: AngleMode;
  solveStyle: SolveStyle;
  answerMode: AnswerMode;
  /** Significant digits for decimal answers. */
  digits: number;
};

import { ANS_VARIABLE, CALL_OR_PRODUCT, DEGREE_VARIABLE, POINT, splitTopLevel } from "./latex-to-giac";

// Every result is stored here so its LaTeX and decimal value can be read back
// without evaluating the input twice (which would repeat side effects).
const RESULT = "maddox_result";

const OR = "\\text{ or }";
const AND = "\\text{ and }";

export class GiacSession {
  private options: SessionOptions = { angle: "rad", solveStyle: "textbook", answerMode: "auto", digits: 6 };

  constructor(
    private caseval: Caseval,
    /** Returns and clears what Giac printed since the last call. */
    private takePrinted: () => string[],
  ) {
    this.defineHelpers();
    this.applyAngle();
  }

  configure(options: Partial<SessionOptions>) {
    Object.assign(this.options, options);
    if (options.angle !== undefined) this.applyAngle();
  }

  setAngle(mode: AngleMode) {
    this.configure({ angle: mode });
  }

  // Helpers the session itself calls. restart clears them with everything
  // else, so this runs again after every reset.
  private defineHelpers() {
    // 1: a point, 2: a list of points, 3: a sequence (1,3 without brackets), 0: anything else.
    this.caseval("maddox_ispoint(t):=when(type(t)==DOM_LIST,when(subtype(t)==27,1,0),0)");
    this.caseval(
      "maddox_shape(v):=when(type(v)!=DOM_LIST,0,when(subtype(v)==27,1,when(subtype(v)==1,3," +
        "when(size(v)>0 && subtype(v)==0 && sum(apply(maddox_ispoint,v))==size(v),2,0))))",
    );
    // A point or a flat list as a column matrix; anything else unchanged.
    this.caseval("maddox_col(v):=when(type(v)==DOM_LIST && size(v)>0 && type(v[0])!=DOM_LIST,transpose([v]),v)");
    // 3: a point, 1: a flat list, 2: a column matrix (n×1), 0: anything else.
    this.caseval(
      "maddox_kind(v):=when(type(v)!=DOM_LIST || size(v)==0,0,when(subtype(v)==27,3,when(type(v[0])!=DOM_LIST,1," +
        "when(subtype(v[0])!=27 && coldim(v)==1,2,0))))",
    );
    this.takePrinted();
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
    // A point or list with a column matrix: Giac pairs them element by
    // element into nonsense (poly1[…]) or a point, so make both columns.
    const operands = this.operands(giac);
    const input = (operands.point || operands.list) && operands.column ? asColumns(giac) : giac;
    const raw = this.caseval(`${RESULT}:=(${input})`);
    const error = findError(raw, this.takePrinted(), giac);
    if (error) return { ok: false, error };
    // Matrix times point loses the point's kind ([3,5]): a vector made from
    // points is a point, unless the input wrote a list itself.
    if (operands.point && !operands.list && this.caseval(`maddox_kind(${RESULT})`) === "1") {
      this.caseval(`${RESULT}:=${POINT}[op(${RESULT})]`);
      this.takePrinted();
    }

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
    if (this.options.answerMode === "exact") return { ok: true, latex, approxLatex: null };
    if (this.options.answerMode === "approx") {
      // The decimal form takes the exact form's place, when there is one.
      return { ok: true, latex: showApprox(latex, approxText) ? approxLatex : latex, approxLatex: null };
    }
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

  /** Whether the input uses points, flat lists and column matrices, written out or in variables. */
  private operands(giac: string): { point: boolean; list: boolean; column: boolean } {
    const body = giac.replace(/^\s*[A-Za-z_][A-Za-z0-9_]*\s*:=/, "");
    const point = body.includes(`${POINT}[`);
    // A "[" that is not indexing (v[…]), a matrix row ([[…],[…]]) or a point.
    const list = /(?<![\w\])[,]\s*)\[(?!\s*\[)/.test(body);
    let column = /\[\s*\[[^[\],]*\](?:\s*,\s*\[[^[\],]*\])*\s*\]/.test(body);
    let usesPoint = point;
    let usesList = list;
    const names = [...new Set(body.match(OPERAND_NAMES) ?? [])].filter((n) => n !== POINT);
    if (names.length) {
      const kinds = this.caseval(`[${names.map((n) => `maddox_kind(${n})`).join(",")}]`);
      this.takePrinted();
      usesPoint ||= /\b3\b/.test(kinds);
      usesList ||= /\b1\b/.test(kinds);
      column ||= /\b2\b/.test(kinds);
    }
    // `list` (for keeping a result a list) counts only lists written here or held in variables.
    return { point: usesPoint, list: usesList, column };
  }

  /** Exact form; a result that already holds decimals is shown rounded like any decimal. */
  private exactLatex(expr: string, roundDecimals = true): string {
    const shaped = this.shapedLatex(expr, (item) => this.exactLatex(item, false));
    if (shaped !== null) return roundDecimals && /\d\.\d/.test(shaped) ? this.decimalLatex(expr) : shaped;
    // regroup collects like terms (x+x is 2x), as Xcas does by default.
    const latex = cleanLatex(unquote(this.caseval(`latex(regroup(${expr}))`)));
    return roundDecimals && /\d\.\d/.test(latex) ? this.decimalLatex(expr) : latex;
  }

  private decimalLatex(expr: string): string {
    const shaped = this.shapedLatex(expr, (item) => this.decimalLatex(item));
    if (shaped !== null) return shaped;
    const latex = cleanLatex(unquote(this.caseval(`latex(evalf(${expr},${this.options.digits}))`)));
    // "2.0" next to "3.5" in a decimal matrix is noise; show "2".
    return latex.replace(/(\d)\.0(?!\d)/g, "$1");
  }

  /**
   * A point as (1, 3), a list of points as [(1, 3), (3, 8)], a bare
   * sequence as 1, 3; null for anything else. Giac's latex() prints a point
   * as "ggbvect[1,3]", and evalf(seq, digits) would take the digits as one
   * more element of the sequence, so each element is shown on its own.
   */
  private shapedLatex(expr: string, each: (item: string) => string): string | null {
    const shape = this.caseval(`maddox_shape(${expr})`);
    if (shape !== "1" && shape !== "2" && shape !== "3") return null;
    const n = Number(this.caseval(`size(${expr})`));
    const items = Array.from({ length: n }, (_, k) => each(`(${expr})[${k}]`)).join(",\\,");
    if (shape === "1") return `\\left(${items}\\right)`;
    if (shape === "2") return `\\left[${items}\\right]`;
    return items;
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
    const marker = new RegExp(`([A-Za-z_][A-Za-z0-9_]*)${CALL_OR_PRODUCT}\\(`);
    // Left to right, one marker at a time: a product with a point rewrites
    // its brackets, which moves everything after it.
    for (let m = giac.match(marker); m; m = giac.match(marker)) {
      const name = m[1];
      const open = m.index! + name.length + CALL_OR_PRODUCT.length;
      const close = matchingParen(giac, open);
      const before = giac.slice(0, m.index! + name.length);
      const rest = giac.slice(open);
      if (close >= 0 && /^\s*:=/.test(giac.slice(close + 1))) {
        giac = before + rest;
        continue;
      }
      if (!isFunction.has(name)) isFunction.set(name, this.caseval(`type(${name})`) === "func");
      if (isFunction.get(name) || close < 0) {
        giac = before + (isFunction.get(name) ? "" : "*") + rest;
        continue;
      }
      // b(1,3) where b is a number or a vector: b times the point (1,3).
      const inside = giac.slice(open + 1, close);
      const point = splitTopLevel(inside).length > 1 && !/^\s*->/.test(giac.slice(close + 1));
      giac = before + "*" + (point ? `${POINT}[${inside}]` : `(${inside})`) + giac.slice(close + 1);
    }
    this.takePrinted();
    return giac;
  }

  /** Forgets every variable and function the user defined. */
  reset() {
    this.caseval("restart");
    this.takePrinted();
    this.defineHelpers();
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

// Names used as values: not calls f(…), indexing v[…], or the point keyword.
const OPERAND_NAMES = /(?<![\w.])[A-Za-z_][A-Za-z0-9_]*(?![\w(\[])/g;

/**
 * The input with every name, point and list on the right-hand side wrapped
 * in maddox_col, which turns points and flat lists into columns and leaves
 * everything else alone.
 */
function asColumns(giac: string): string {
  const head = giac.match(/^\s*[A-Za-z_][A-Za-z0-9_]*\s*:=/)?.[0] ?? "";
  const body = giac.slice(head.length).replace(OPERAND_NAMES, (name) => `maddox_col(${name})`);
  let out = "";
  for (let i = 0; i < body.length; i++) {
    const atPoint = body.startsWith(`${POINT}[`, i) && !/\w/.test(body[i - 1] ?? "");
    const atList = body[i] === "[" && !/[\w\])]/.test(body.slice(0, i).trimEnd().slice(-1));
    if (!atPoint && !atList) {
      out += body[i];
      continue;
    }
    const open = atPoint ? i + POINT.length : i;
    let depth = 0;
    let close = open;
    for (; close < body.length; close++) {
      if (body[close] === "[") depth++;
      else if (body[close] === "]" && --depth === 0) break;
    }
    out += `maddox_col(${body.slice(i, close + 1)})`;
    i = close;
  }
  return head + out;
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
  const text = approxText.replace(/^list/, "").replaceAll(POINT, "");
  // evalf(10) is "10.0": a whole number gains nothing from a decimal.
  if (!/\d\.\d/.test(text.replace(/(\d)\.0\b/g, "$1"))) return false;
  return /^[\s\d.,+\-*/e^i[\]()]*$/.test(text.replace(/\binf(inity)?\b/g, ""));
}
