// Converts the LaTeX a MathLive math-field produces into Giac input syntax.
//
// Juxtaposition needs care: Giac has no implicit multiplication between
// arbitrary operands ("(x+1)x" and "sin(x)cos(x)" are syntax errors), so the
// converter emits explicit "*" between adjacent operands.
//
// A typed name followed by "(" is ambiguous: f(2) is a call if f is a
// function, but 3x(4y+8z) is a product. Only the engine knows which names are
// functions, so the converter puts CALL_OR_PRODUCT there and GiacSession
// decides. Names from \operatorname{...} (solve, det, ...) are always calls.
//
// Multi-letter runs stay one name ("xy" is the variable xy), matching the
// TI-Nspire and Giac convention.

export class UnsupportedLatex extends Error {}

/** What "ans" (the previous result) becomes; Giac reserves the name ans. */
export const ANS_VARIABLE = "maddox_ans";

/** Marks "name(" where only the engine can tell a call from a product. */
export const CALL_OR_PRODUCT = "\u0002";

/** What ° becomes: 30° is 30*maddox_deg. GiacSession sets it to pi/180 in
 * radian mode and to 1 in degree mode, so 30° means 30 degrees in both. */
export const DEGREE_VARIABLE = "maddox_deg";

type Token = { kind: "cmd" | "char"; value: string };

// What a piece of output is, for deciding whether "*" goes between two pieces.
//   value: a complete operand (number, name, parenthesised group)
//   name:  a typed identifier; a following "(" may be a call or a product
//   fname: a command name from \operatorname{...}; a following "(" is a call
//   post:  a postfix that ends an operand (^(...), !) but cannot start one
//   op:    an operator or punctuation
type Kind = "value" | "name" | "fname" | "post" | "op";
type Piece = { text: string; kind: Kind };

const GREEK = new Set([
  "alpha", "beta", "gamma", "delta", "epsilon", "varepsilon", "zeta", "eta",
  "theta", "vartheta", "iota", "kappa", "lambda", "mu", "nu", "xi", "rho",
  "sigma", "tau", "upsilon", "phi", "varphi", "chi", "psi", "omega",
  "Delta", "Theta", "Lambda", "Xi", "Sigma", "Upsilon", "Phi", "Psi", "Omega",
]);

// LaTeX function commands and their Giac names. \log is base 10, as on TI
// calculators; Giac's own log() is the natural log.
const FUNCTIONS: Record<string, string> = {
  sin: "sin", cos: "cos", tan: "tan", cot: "cot", sec: "sec", csc: "csc",
  arcsin: "asin", arccos: "acos", arctan: "atan",
  sinh: "sinh", cosh: "cosh", tanh: "tanh", coth: "coth",
  exp: "exp", ln: "ln", log: "log10", lg: "log10",
  det: "det", min: "min", max: "max", gcd: "gcd", arg: "arg",
};
const INVERSE_TRIG: Record<string, string> = {
  sin: "asin", cos: "acos", tan: "atan", sinh: "asinh", cosh: "acosh", tanh: "atanh",
};

const SYMBOLS: Record<string, Piece> = {
  pi: { text: "pi", kind: "name" },
  infty: { text: "inf", kind: "name" },
  exponentialE: { text: "e", kind: "name" },
  imaginaryI: { text: "i", kind: "name" },
  cdot: { text: "*", kind: "op" },
  times: { text: "*", kind: "op" },
  div: { text: "/", kind: "op" },
  le: { text: "<=", kind: "op" },
  leq: { text: "<=", kind: "op" },
  ge: { text: ">=", kind: "op" },
  geq: { text: ">=", kind: "op" },
  ne: { text: "!=", kind: "op" },
  neq: { text: "!=", kind: "op" },
  lt: { text: "<", kind: "op" },
  gt: { text: ">", kind: "op" },
  coloneq: { text: ":=", kind: "op" },
  coloneqq: { text: ":=", kind: "op" },
  to: { text: "->", kind: "op" },
  rightarrow: { text: "->", kind: "op" },
};

const SPACING = new Set([",", ";", "!", ":", " ", "quad", "qquad", "enspace",
  "thinspace", "medspace", "thickspace", "negthinspace", "negmedspace", "negthickspace"]);
const TEXT_LIKE = new Set(["operatorname", "mathrm", "text", "mathit", "textrm", "mathsf", "mathbf"]);
const MATRIX_ENVS = new Set(["pmatrix", "bmatrix", "Bmatrix", "matrix", "smallmatrix", "vmatrix"]);

const OPEN_DELIMS: Record<string, string> = { "(": "(", "[": "[", lbrack: "[", "{": "(", lbrace: "(", lparen: "(" };
const CLOSE_DELIMS: Record<string, string> = { ")": ")", "]": "]", rbrack: "]", "}": ")", rbrace: ")", rparen: ")" };
const BAR_DELIMS = new Set(["|", "vert", "lvert", "rvert", "mvert"]);

function tokenize(latex: string): Token[] {
  const tokens: Token[] = [];
  const re = /\\([A-Za-z]+)|\\(.)|(\s+)|(.)/gsy;
  for (const m of latex.matchAll(re)) {
    if (m[1] !== undefined) tokens.push({ kind: "cmd", value: m[1] });
    else if (m[2] !== undefined) tokens.push({ kind: "cmd", value: m[2] });
    else if (m[4] !== undefined) tokens.push({ kind: "char", value: m[4] });
  }
  return tokens;
}

function endsOperand(p: Piece): boolean {
  return p.kind !== "op";
}

function startsOperand(p: Piece): boolean {
  return p.kind === "value" || p.kind === "name" || p.kind === "fname";
}

/** Joins pieces, inserting "*" wherever two operands touch. */
class Emitter {
  private pieces: Piece[] = [];

  push(p: Piece) {
    const prev = this.pieces[this.pieces.length - 1];
    if (prev && endsOperand(prev) && startsOperand(p)) {
      const named = prev.kind === "name" || prev.kind === "fname";
      if (named && p.text.startsWith("[")) {
        // indexing: v[1]
      } else if (prev.kind === "fname" && p.text.startsWith("(")) {
        // a command: solve(...)
      } else if (prev.kind === "name" && p.text.startsWith("(")) {
        this.pieces.push({ text: CALL_OR_PRODUCT, kind: "op" });
      } else {
        this.pieces.push({ text: "*", kind: "op" });
      }
    }
    this.pieces.push(p);
  }

  /** Glues a subscript onto the previous name: x then 1 gives x_1. */
  appendToName(suffix: string): boolean {
    const prev = this.pieces[this.pieces.length - 1];
    if (!prev || prev.kind !== "name") return false;
    prev.text += suffix;
    return true;
  }

  get isEmpty() {
    return this.pieces.length === 0;
  }

  toString() {
    return this.pieces.map((p) => p.text).join("");
  }
}

// Stands in for \differentialD until leibnizDerivative() consumes it.
const DIFFERENTIAL = "\u0001d";

type Stop = (t: Token, next: Token | undefined) => boolean;

const atChar = (c: string): Stop => (t) => t.kind === "char" && t.value === c;

class Converter {
  private i = 0;
  constructor(private tokens: Token[]) {}

  private peek(offset = 0): Token | undefined {
    return this.tokens[this.i + offset];
  }

  private isChar(c: string, offset = 0) {
    const t = this.peek(offset);
    return t?.kind === "char" && t.value === c;
  }

  private isCmd(name: string, offset = 0) {
    const t = this.peek(offset);
    return t?.kind === "cmd" && t.value === name;
  }

  private expectChar(c: string) {
    if (!this.isChar(c)) throw new UnsupportedLatex(`Expected '${c}'`);
    this.i++;
  }

  /** Converts tokens until `stop` matches (not consumed) or input ends. */
  convertUntil(stop?: Stop): string {
    const out = new Emitter();
    while (this.i < this.tokens.length) {
      const t = this.tokens[this.i];
      if (stop?.(t, this.tokens[this.i + 1])) break;
      this.item(out, stop);
    }
    return out.toString();
  }

  /** A brace group's body, or a single token when there are no braces. */
  private arg(): string {
    if (this.isChar("{")) {
      this.i++;
      const inner = this.convertUntil(atChar("}"));
      this.expectChar("}");
      return inner;
    }
    const t = this.peek();
    if (!t) throw new UnsupportedLatex("Missing argument");
    // Without braces a LaTeX argument is one character: \frac13 is 1/3.
    if (t.kind === "char" && /[A-Za-z0-9]/.test(t.value)) {
      this.i++;
      return t.value;
    }
    const out = new Emitter();
    this.item(out);
    return out.toString();
  }

  /** The raw text inside a brace group, e.g. the name in \operatorname{solve}. */
  private rawGroup(): string {
    this.expectChar("{");
    let depth = 1;
    let text = "";
    while (this.i < this.tokens.length) {
      const t = this.tokens[this.i++];
      if (t.kind === "char" && t.value === "{") depth++;
      if (t.kind === "char" && t.value === "}" && --depth === 0) return text;
      text += t.kind === "cmd" ? "\\" + t.value : t.value;
    }
    throw new UnsupportedLatex("Unterminated group");
  }

  private item(out: Emitter, stop?: Stop) {
    const t = this.tokens[this.i++];
    if (t.kind === "char") this.char(t.value, out);
    else this.command(t.value, out, stop);
  }

  private char(c: string, out: Emitter) {
    if (/[0-9.]/.test(c)) {
      let num = c;
      while (this.peek()?.kind === "char" && /[0-9.]/.test(this.peek()!.value)) num += this.tokens[this.i++].value;
      out.push({ text: num, kind: "value" });
      return;
    }
    if (/[A-Za-z]/.test(c)) {
      let name = c;
      while (this.peek()?.kind === "char" && /[A-Za-z0-9]/.test(this.peek()!.value)) name += this.tokens[this.i++].value;
      out.push({ text: name === "ans" ? ANS_VARIABLE : name, kind: "name" });
      return;
    }
    switch (c) {
      case "{": {
        const inner = this.convertUntil(atChar("}"));
        this.expectChar("}");
        if (inner) out.push({ text: `(${inner})`, kind: "value" });
        return;
      }
      case "}":
        throw new UnsupportedLatex("Unexpected '}'");
      case "(":
      case "[": {
        const close = c === "(" ? ")" : "]";
        const inner = this.convertUntil(atChar(close));
        this.expectChar(close);
        out.push({ text: c + inner + close, kind: "value" });
        return;
      }
      case ")":
      case "]":
        throw new UnsupportedLatex(`Unmatched '${c}'`);
      case "|": {
        const inner = this.convertUntil(atChar("|"));
        this.expectChar("|");
        out.push({ text: `abs(${inner})`, kind: "value" });
        return;
      }
      case "^":
        // 30^{\circ} (or 30^\circ) is how a degree sign is often written.
        if (this.isCmd("circ") || (this.isChar("{") && this.isCmd("circ", 1) && this.isChar("}", 2))) {
          this.i += this.isCmd("circ") ? 1 : 3;
          out.push({ text: `*${DEGREE_VARIABLE}`, kind: "post" });
          return;
        }
        out.push({ text: `^(${this.arg()})`, kind: "post" });
        return;
      case "_": {
        const sub = this.arg().replace(/[()]/g, "");
        if (!/^[A-Za-z0-9]+$/.test(sub)) throw new UnsupportedLatex(`Unsupported subscript: ${sub}`);
        if (!out.appendToName("_" + sub)) throw new UnsupportedLatex("A subscript needs a variable name before it");
        return;
      }
      case "!":
        out.push({ text: "!", kind: "post" });
        return;
      case "'":
        out.push({ text: "'", kind: "post" });
        return;
      case "&":
        throw new UnsupportedLatex("Unexpected '&' outside a matrix");
      case ":":
        if (this.isChar("=")) {
          this.i++;
          out.push({ text: ":=", kind: "op" });
          return;
        }
        out.push({ text: ":", kind: "op" });
        return;
      default:
        out.push({ text: c, kind: "op" });
    }
  }

  private command(name: string, out: Emitter, stop?: Stop) {
    if (SPACING.has(name)) return;
    if (name in SYMBOLS) {
      out.push({ ...SYMBOLS[name] });
      return;
    }
    if (GREEK.has(name)) {
      out.push({ text: name, kind: "name" });
      return;
    }
    if (name in FUNCTIONS) return this.func(name, out);
    if (TEXT_LIKE.has(name)) {
      const text = unwrapTextLike(this.rawGroup()).trim();
      if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(text)) throw new UnsupportedLatex(`Unsupported name: ${text}`);
      out.push({ text, kind: "fname" });
      return;
    }
    switch (name) {
      case "left":
      case "mleft":
        return this.leftRight(out);
      case "right":
      case "mright":
        throw new UnsupportedLatex("Unmatched \\right");
      case "frac":
      case "dfrac":
      case "tfrac":
        return this.frac(out, stop);
      case "sqrt": {
        if (this.isChar("[")) {
          this.i++;
          const n = this.convertUntil(atChar("]"));
          this.expectChar("]");
          out.push({ text: `surd(${this.arg()},${n})`, kind: "value" });
        } else {
          out.push({ text: `sqrt(${this.arg()})`, kind: "value" });
        }
        return;
      }
      case "binom":
        out.push({ text: `comb(${this.arg()},${this.arg()})`, kind: "value" });
        return;
      case "int":
        return this.integral(out, stop);
      case "sum":
      case "prod":
        return this.bigOperator(name === "sum" ? "sum" : "product", out, stop);
      case "lim":
        return this.limit(out, stop);
      case "degree":
        out.push({ text: `*${DEGREE_VARIABLE}`, kind: "post" });
        return;
      case "differentialD":
        // Only meaningful inside d/dx; latexToGiac rejects any that survive.
        out.push({ text: DIFFERENTIAL, kind: "name" });
        return;
      case "placeholder":
        this.rawGroup();
        throw new UnsupportedLatex("Fill in the empty boxes first");
      case "begin":
        return this.environment(this.rawGroup(), out);
      case "end":
        throw new UnsupportedLatex("Unexpected \\end");
      case "lbrack":
      case "rbrack":
      case "lparen":
      case "rparen":
        // Bare delimiters MathLive emits when a fence is unbalanced.
        return this.char({ lbrack: "[", rbrack: "]", lparen: "(", rparen: ")" }[name]!, out);
      case "vert":
      case "lvert":
        return this.char("|", out);
      case "\\":
        throw new UnsupportedLatex("Line breaks are only allowed inside a matrix");
    }
    throw new UnsupportedLatex(`Unsupported notation: \\${name}`);
  }

  /** \sin x, \sin(x), \sin^2 x, \sin^{-1} x, \log_2 8 */
  private func(name: string, out: Emitter) {
    let giac = FUNCTIONS[name];
    let power: string | null = null;
    let base: string | null = null;
    if (this.isChar("^")) {
      this.i++;
      power = this.arg();
      if (power === "-1" && INVERSE_TRIG[name]) {
        giac = INVERSE_TRIG[name];
        power = null;
      }
    }
    if (this.isChar("_")) {
      if (name !== "log") throw new UnsupportedLatex(`Unsupported subscript on \\${name}`);
      this.i++;
      base = this.arg();
    }
    const argument = this.functionArgument();
    let call = base !== null ? `logb(${argument},${base})` : `${giac}(${argument})`;
    if (power !== null) call = `(${call})^(${power})`;
    out.push({ text: call, kind: "value" });
  }

  /** A parenthesised argument, or else the next operand (\sin 2x is sin(2*x)). */
  private functionArgument(): string {
    while (this.peek()?.kind === "cmd" && SPACING.has(this.peek()!.value)) this.i++;
    if (this.isCmd("left") && this.peek(1)?.value === "(") {
      this.i += 2;
      const inner = this.convertUntil((t, next) => t.kind === "cmd" && t.value === "right" && next?.value === ")");
      this.i += 2;
      return inner;
    }
    if (this.isChar("(")) {
      this.i++;
      const inner = this.convertUntil(atChar(")"));
      this.expectChar(")");
      return inner;
    }
    // Operand without parentheses: consume numbers/names that juxtapose.
    const out = new Emitter();
    if (!this.peek()) throw new UnsupportedLatex("Function is missing its argument");
    this.item(out);
    while (this.peek()?.kind === "char" && /[A-Za-z0-9.]/.test(this.peek()!.value)) this.item(out);
    return out.toString();
  }

  private leftRight(out: Emitter) {
    const open = this.tokens[this.i++];
    if (!open) throw new UnsupportedLatex("Unterminated \\left");
    const isClose = (t: Token, next: Token | undefined) =>
      t.kind === "cmd" && (t.value === "right" || t.value === "mright") && next !== undefined;
    const inner = this.convertUntil(isClose);
    if (!this.peek()) throw new UnsupportedLatex("Missing \\right");
    this.i++;
    const close = this.tokens[this.i++];

    if (BAR_DELIMS.has(open.value)) {
      out.push({ text: `abs(${inner})`, kind: "value" });
      return;
    }
    const o = open.value === "." ? "" : OPEN_DELIMS[open.value];
    const c = close.value === "." ? "" : CLOSE_DELIMS[close.value];
    if (o === undefined || c === undefined) throw new UnsupportedLatex(`Unsupported delimiter: ${open.value}`);
    // An unclosed fence still in progress, e.g. \left(x\right. while typing.
    const left = o || (c === "]" ? "[" : "(");
    const right = c || (left === "[" ? "]" : ")");
    out.push({ text: left + inner + right, kind: "value" });
  }

  private frac(out: Emitter, stop?: Stop) {
    const num = this.arg();
    const den = this.arg();
    const leibniz = leibnizDerivative(num, den);
    if (leibniz) {
      const body = this.convertUntil(stop);
      if (!body) throw new UnsupportedLatex("d/dx needs an expression after it");
      const order = leibniz.order === "1" ? "" : `,${leibniz.order}`;
      out.push({ text: `diff(${body},${leibniz.variable}${order})`, kind: "value" });
      return;
    }
    out.push({ text: `((${num})/(${den}))`, kind: "value" });
  }

  /** Reads \int's optional limits as [lower, upper]. */
  private limits(): [string | null, string | null] {
    let lower: string | null = null;
    let upper: string | null = null;
    for (let k = 0; k < 2; k++) {
      if (this.isChar("_")) {
        this.i++;
        lower = this.arg();
      } else if (this.isChar("^")) {
        this.i++;
        upper = this.arg();
      }
    }
    return [lower, upper];
  }

  private integral(out: Emitter, stop?: Stop) {
    const [lower, upper] = this.limits();
    if ((lower === null) !== (upper === null) || lower === "" || upper === "") {
      throw new UnsupportedLatex("Fill in both limits of the integral, or neither");
    }
    const isDifferential: Stop = (t, next) =>
      (t.kind === "cmd" && t.value === "differentialD") ||
      (t.kind === "cmd" && t.value === "mathrm" && next?.value === "{" && this.tokens[this.i + 2]?.value === "d" && this.tokens[this.i + 3]?.value === "}");
    const body = this.convertUntil((t, next) => isDifferential(t, next) || (stop?.(t, next) ?? false));
    if (!this.peek() || !isDifferential(this.peek()!, this.peek(1))) {
      throw new UnsupportedLatex("An integral needs a dx at the end (type dx)");
    }
    if (this.isCmd("differentialD")) this.i++;
    else this.i += 4; // \mathrm { d }
    while (this.peek()?.kind === "cmd" && SPACING.has(this.peek()!.value)) this.i++;
    const variable = this.peek();
    if (variable?.kind !== "char" || !/[A-Za-z]/.test(variable.value)) {
      throw new UnsupportedLatex("Expected the integration variable after d");
    }
    this.i++;
    if (!body) throw new UnsupportedLatex("The integral is empty");
    const range = lower !== null ? `,${lower},${upper}` : "";
    out.push({ text: `int(${body},${variable.value}${range})`, kind: "value" });
  }

  private bigOperator(giac: string, out: Emitter, stop?: Stop) {
    const [lower, upper] = this.limits();
    const m = lower?.match(/^([A-Za-z][A-Za-z0-9_]*)=(.+)$/);
    if (!m || !upper) throw new UnsupportedLatex(`Write the ${giac} as k=1 below and the end value above`);
    const body = this.convertUntil(stop);
    if (!body) throw new UnsupportedLatex(`The ${giac} is empty`);
    out.push({ text: `${giac}(${body},${m[1]},${m[2]},${upper})`, kind: "value" });
  }

  private limit(out: Emitter, stop?: Stop) {
    if (!this.isChar("_")) throw new UnsupportedLatex("Write the limit as lim with x→a below it");
    this.i++;
    const sub = this.arg();
    const m = sub.match(/^([A-Za-z][A-Za-z0-9_]*)->(.+)$/);
    if (!m) throw new UnsupportedLatex("Write the limit as lim with x→a below it");
    const body = this.convertUntil(stop);
    if (!body) throw new UnsupportedLatex("The limit is empty");
    out.push({ text: `limit(${body},${m[1]},${m[2]})`, kind: "value" });
  }

  private environment(env: string, out: Emitter) {
    if (!MATRIX_ENVS.has(env)) throw new UnsupportedLatex(`Unsupported notation: ${env}`);
    // pmatrix may carry a column spec, e.g. \begin{pmatrix}[cc]... (not emitted by MathLive today)
    const rows: string[][] = [[]];
    const cellEnd: Stop = (t) =>
      (t.kind === "char" && t.value === "&") || (t.kind === "cmd" && (t.value === "\\" || t.value === "cr" || t.value === "end"));
    for (;;) {
      const cell = this.convertUntil(cellEnd);
      rows[rows.length - 1].push(cell);
      const t = this.peek();
      if (!t) throw new UnsupportedLatex("Unterminated matrix");
      this.i++;
      if (t.kind === "char") continue; // &
      if (t.value === "end") {
        if (this.rawGroup() !== env) throw new UnsupportedLatex("Mismatched \\end");
        break;
      }
      rows.push([]);
    }
    // MathLive leaves a trailing empty row after a final "\\".
    const last = rows[rows.length - 1];
    if (rows.length > 1 && last.length === 1 && last[0] === "") rows.pop();
    if (rows.some((r) => r.some((c) => c === ""))) throw new UnsupportedLatex("Fill in every cell of the matrix");
    const width = rows[0].length;
    if (rows.some((r) => r.length !== width)) throw new UnsupportedLatex("Every matrix row needs the same number of cells");
    const matrix = "[" + rows.map((r) => "[" + r.join(",") + "]").join(",") + "]";
    out.push({ text: env === "vmatrix" ? `det(${matrix})` : matrix, kind: "value" });
  }
}

function unwrapTextLike(raw: string): string {
  // MathLive can nest e.g. \operatorname{\mathrm{solve}}.
  for (;;) {
    const m = raw.match(/^\\(?:operatorname|mathrm|text|mathit|textrm|mathsf|mathbf)\{(.*)\}$/s);
    if (!m) return raw;
    raw = m[1];
  }
}

/** Recognises d/dx, dy/dx and d^2/dx^2 written as a fraction. */
function leibnizDerivative(num: string, den: string): { variable: string; order: string } | null {
  num = num.replaceAll(DIFFERENTIAL, "d");
  den = den.replaceAll(DIFFERENTIAL, "d");
  const n = num.match(/^d(?:\^\((\d+)\))?$/);
  const d = den.match(/^d\*?([A-Za-z][A-Za-z0-9_]*?)(?:\^\((\d+)\))?$/);
  if (!n || !d) return null;
  const order = n[1] ?? "1";
  if ((d[2] ?? "1") !== order) return null;
  return { variable: d[1], order };
}

export function latexToGiac(latex: string): string {
  const converter = new Converter(tokenize(latex));
  const result = converter.convertUntil();
  if (result.includes(DIFFERENTIAL)) throw new UnsupportedLatex("A d on its own only works in d/dx or at the end of an integral");
  return result;
}
