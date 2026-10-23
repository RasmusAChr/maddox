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
//
// Round brackets holding a comma are a point (a vector of any length):
// (1,3) becomes POINT[1,3], Giac's GeoGebra vector, which keeps its kind
// through arithmetic so results show as (…) again. Not after a function name
// (a call), and not before -> ((x,y)->x+y is a function). Square brackets
// after a name index from 1, as in maths notation: v[1] is the first element.
//
// f′(x) is Giac's f'(x), the derivative of f at x: the prime makes the name a
// function name, so the brackets that follow are always a call. 20% is
// (20/100). A cases environment (value & condition per row) is piecewise(…).

export class UnsupportedLatex extends Error {}

/** Giac's point type: a vector that prints and computes like one. */
export const POINT = "ggbvect";

/** Splits on commas that are not inside (), [] or {}. */
export function splitTopLevel(s: string): string[] {
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
type Piece = {
  text: string;
  kind: Kind;
  /** A round-bracket group with a comma: its inside, e.g. "1,3". */
  tuple?: string;
  /** A square-bracket group: its inside. */
  bracket?: string;
  /** An index, v[…], so a following […] indexes further: M[1][2]. */
  index?: boolean;
  /** A unit, (_km/_h): always multiplies, never a call's brackets. */
  unit?: boolean;
};

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
    // (x,y)->x+y: the brackets hold a function's parameters, not a point.
    if (p.text === "->" && prev?.tuple !== undefined) prev.text = `(${prev.tuple})`;
    let asPoint = p.tuple !== undefined;
    if (prev && endsOperand(prev) && startsOperand(p)) {
      const named = prev.kind === "name" || prev.kind === "fname";
      if ((named || prev.index) && p.bracket !== undefined) {
        // indexing: v[1]
        p = { ...p, text: `[${fromOne(p.bracket)}]`, index: true };
      } else if (prev.kind === "fname" && p.text.startsWith("(") && !p.unit) {
        // a command: solve(...)
        asPoint = false;
      } else if (prev.kind === "name" && p.text.startsWith("(") && !p.unit) {
        // GiacSession decides; it makes b(1,3) a product with a point.
        this.pieces.push({ text: CALL_OR_PRODUCT, kind: "op" });
        asPoint = false;
      } else {
        this.pieces.push({ text: "*", kind: "op" });
      }
    }
    if (asPoint) p = { ...p, text: `${POINT}[${p.tuple}]` };
    this.pieces.push(p);
  }

  /** f then ′ gives f': a derivative, which the following ( calls. */
  prime(count: number) {
    const prev = this.pieces[this.pieces.length - 1];
    if (!prev || (prev.kind !== "name" && !(prev.kind === "fname" && prev.text.endsWith("'")))) {
      throw new UnsupportedLatex("Write ′ after a function name, e.g. f′(x)");
    }
    prev.text += "'".repeat(count);
    prev.kind = "fname";
  }

  /** 20% is (20/100): the operand just before, with its powers and calls. */
  percent() {
    let j = this.pieces.length - 1;
    while (j >= 0 && (this.pieces[j].kind === "post" || this.pieces[j].index)) j--;
    if (j < 0 || this.pieces[j].kind === "op") throw new UnsupportedLatex("Write % after a number, e.g. 20%");
    const before = this.pieces[j - 1];
    if (before?.text === CALL_OR_PRODUCT) j -= 2;
    else if (before?.kind === "fname" && this.pieces[j].text.startsWith("(")) j -= 1;
    const operand = this.pieces.splice(j).map((p) => p.text).join("");
    this.pieces.push({ text: `((${operand})/100)`, kind: "value" });
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

  /** After ^: the number of primes in \prime, {\prime\prime} or \doubleprime (consumed), else 0. */
  private primes(): number {
    const count = (t: Token | undefined) =>
      t?.kind === "cmd" ? (t.value === "prime" ? 1 : t.value === "doubleprime" ? 2 : 0) : 0;
    if (count(this.peek())) return count(this.tokens[this.i++]);
    if (!this.isChar("{")) return 0;
    let n = 0;
    let k = 1;
    while (count(this.peek(k))) n += count(this.peek(k++));
    if (!n || !this.isChar("}", k)) return 0;
    this.i += k + 1;
    return n;
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
        out.push(group(c, inner, close));
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
      case "^": {
        // f^{\prime}: MathLive's f′. f″ comes as f^{\prime}^{\prime} or f^{\prime\prime}.
        const primes = this.primes();
        if (primes) {
          out.prime(primes);
          return;
        }
        // 30^{\circ} (or 30^\circ) is how a degree sign is often written.
        if (this.isCmd("circ") || (this.isChar("{") && this.isCmd("circ", 1) && this.isChar("}", 2))) {
          this.i += this.isCmd("circ") ? 1 : 3;
          out.push({ text: `*${DEGREE_VARIABLE}`, kind: "post" });
          return;
        }
        out.push({ text: `^(${this.arg()})`, kind: "post" });
        return;
      }
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
        // Pasted f'(x); typed primes come as ^{\prime}.
        out.prime(1);
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
    // Upright letters are a unit (5 m/s), unless they name a function: \mathrm{d} is the
    // d of dx, and \mathrm{transpose}(X) is a call.
    if (name === "mathrm" && this.isChar("{")) {
      const start = this.i;
      const text = unwrapTextLike(this.rawGroup()).trim();
      const call = this.isChar("(") || (this.isCmd("left") && this.peek(1)?.value === "(");
      if (text === "d") {
        out.push({ text: DIFFERENTIAL, kind: "name" });
        return;
      }
      if (!call) {
        // MathLive writes m/s² typed in unit mode as \mathrm{m/s}^2: the power is the last unit's.
        let unit = text;
        if (this.isChar("^")) {
          this.i++;
          unit += `^${this.arg()}`;
        }
        out.push({ text: unitToGiac(unit), kind: "value", unit: true });
        return;
      }
      this.i = start;
    }
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
      case "%":
        out.percent();
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
    // \left\{…\right\} also becomes "(…)", but braces are not a point.
    const brace = open.value === "{" || open.value === "lbrace";
    out.push(brace ? { text: left + inner + right, kind: "value" } : group(left, inner, right));
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

  /**
   * A piecewise function: one case per row, value & condition. A condition
   * may start with the word "if"; "otherwise" (last row only) is every other x.
   */
  private cases(out: Emitter) {
    const rowEnd: Stop = (t) => t.kind === "cmd" && (t.value === "\\" || t.value === "cr" || t.value === "end");
    const parts: string[] = [];
    let otherwise: string | null = null;
    for (;;) {
      const value = this.convertUntil((t, next) => atChar("&")(t, next) || rowEnd(t, next));
      const hasCondition = this.isChar("&");
      let condition = "";
      let isOtherwise = false;
      if (hasCondition) {
        this.i++;
        this.skipWord(["if", "for", "when"]);
        isOtherwise = this.skipWord(["otherwise", "else"]) !== null;
        condition = this.convertUntil(rowEnd);
        if (/^(otherwise|else)$/.test(condition)) [isOtherwise, condition] = [true, ""];
      }
      const t = this.peek();
      if (!t) throw new UnsupportedLatex("Unterminated piecewise function");
      this.i++;
      const last = t.value === "end";
      if (last && this.rawGroup() !== "cases") throw new UnsupportedLatex("Mismatched \end");
      // MathLive leaves a trailing empty row after a final "\\".
      if (last && value === "" && !hasCondition) break;
      if (value === "") throw new UnsupportedLatex("Fill in the value of every case");
      if (otherwise !== null) throw new UnsupportedLatex("\"otherwise\" must be the last case");
      if (isOtherwise && condition) throw new UnsupportedLatex("Nothing goes after \"otherwise\"");
      if (isOtherwise) otherwise = value;
      else if (condition) parts.push(condition, value);
      else throw new UnsupportedLatex("Each case needs a condition, e.g. x<0, or the word otherwise");
      if (last) break;
    }
    if (!parts.length) throw new UnsupportedLatex("A piecewise function needs at least one condition");
    if (otherwise !== null) parts.push(otherwise);
    out.push({ text: `piecewise(${parts.join(",")})`, kind: "value" });
  }

  /** Skips a leading word such as \text{if } (or a comma); returns it if found. */
  private skipWord(words: string[]): string | null {
    while (this.peek()?.kind === "cmd" && SPACING.has(this.peek()!.value)) this.i++;
    if (this.isChar(",")) this.i++;
    const t = this.peek();
    if (t?.kind !== "cmd" || !TEXT_LIKE.has(t.value) || !this.isChar("{", 1)) return null;
    const start = this.i;
    this.i++;
    const word = unwrapTextLike(this.rawGroup()).trim();
    if (words.includes(word)) return word;
    this.i = start;
    return null;
  }

  private environment(env: string, out: Emitter) {
    if (env === "cases") return this.cases(out);
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

/** A bracketed group, marked as a point or a square-bracket group for Emitter.push. */
function group(open: string, inner: string, close: string): Piece {
  const piece: Piece = { text: open + inner + close, kind: "value" };
  if (open === "(" && close === ")" && splitTopLevel(inner).length > 1) piece.tuple = inner;
  if (open === "[" && close === "]") piece.bracket = inner;
  return piece;
}

/** Index positions as written (from 1) to Giac's (from 0): v[1] is v[0]. */
function fromOne(inside: string): string {
  return splitTopLevel(inside)
    .map((position) => {
      const p = position.trim();
      if (p === "") throw new UnsupportedLatex("Write a position inside the brackets, e.g. v[1]");
      if (/^\d+$/.test(p)) {
        if (Number(p) === 0) throw new UnsupportedLatex("Positions start at 1: the first element is [1]");
        return String(Number(p) - 1);
      }
      return `(${p})-1`;
    })
    .join(",");
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

// Unit names as typed, where Giac spells them differently ("in" is a Giac keyword).
const UNIT_ALIASES: Record<string, string> = { in: "inch", day: "d", ohm: "Ohm", Ω: "Ohm" };

/**
 * The inside of an upright group as a Giac unit: km/h is (_km/_h), m^2 is
 * (_m^(2)). Names are checked against Giac's units later (GiacSession).
 */
function unitToGiac(text: string): string {
  const source = text
    .replace(/\\Omega\s*/g, "Ω")
    .replace(/\\mu\s*|µ/g, "u")
    // °C and °F as MathLive or the keyboard write them: ° alone is the angle, so these stay one token.
    .replace(/\^\s*\{?\\(?:circ|degree)\}?\s*|\\(?:circ|degree)\s*|º|˚/g, "°")
    .replace(/℃/g, "°C")
    .replace(/℉/g, "°F")
    .replace(/\\cdot|·|\\,|\\ |~/g, "*")
    .replace(/[{}]/g, "")
    .trim();
  let giac = "";
  for (const m of source.matchAll(/(°\s*[CF])|([A-Za-zΩ]+)|(\^\s*-?\d+(?:\.\d+)?)|([*/()])|(\s+)|(.)/gy)) {
    if (m[1]) giac += `_deg${m[1].slice(-1)}`;
    else if (m[2]) giac += `_${UNIT_ALIASES[m[2]] ?? m[2]}`;
    else if (m[3]) giac += `^(${m[3].slice(1).trim()})`;
    else if (m[4]) giac += m[4];
    else if (m[5]) giac += "*";
    else throw new UnsupportedLatex(`Unsupported unit: ${text}`);
  }
  if (!giac) throw new UnsupportedLatex("The unit is empty");
  return `(${giac.replace(/\*+/g, "*").replace(/^\*|\*$/g, "")})`;
}

/**
 * 20 °C → °F or K, and back. The scales have an offset, so Giac's convert()
 * can't do it: maddox_temp (GiacSession) does. Null when it isn't a plain
 * number with a temperature unit going to another one.
 */
function temperatureConversion(source: string, target: string): string | null {
  const to = /^\(_(degC|degF|K)\)$/.exec(target)?.[1];
  const from = /^(.*?)\*?\(_(degC|degF|K)\)$/s.exec(source);
  if (!to || !from || from[2] === to || from[1].includes("_")) return null;
  const scale = (name: string) => name.slice(-1);
  return `maddox_temp(${from[1] || "1"},"${scale(from[2])}","${scale(to)}")`;
}

/** expr -> unit, at the top level, converts: 72 km/h → m/s. */
function conversion(giac: string): string {
  let depth = 0;
  for (let i = giac.length - 1; i > 0; i--) {
    const c = giac[i];
    if (")]".includes(c)) depth++;
    else if ("([".includes(c)) depth--;
    else if (depth === 0 && c === ">" && giac[i - 1] === "-") {
      // Only units (and powers) after the arrow; (x,y)->x+y stays a function.
      const target = giac.slice(i + 1);
      const temperature = temperatureConversion(giac.slice(0, i - 1), target);
      if (temperature) return temperature;
      const rest = target.replace(/_[A-Za-z]+/g, "");
      if (rest === target || !/^[\d*/^().\-]*$/.test(rest)) return giac;
      return `convert(${giac.slice(0, i - 1)},${target})`;
    }
  }
  return giac;
}

export function latexToGiac(latex: string): string {
  const converter = new Converter(tokenize(latex));
  const result = converter.convertUntil();
  if (result.includes(DIFFERENTIAL)) throw new UnsupportedLatex("A d on its own only works in d/dx or at the end of an integral");
  return conversion(result);
}
