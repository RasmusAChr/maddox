/**
 * Suggestions while typing a name: after two letters, the best name that
 * starts with them shows in grey after the caret, and Tab takes it
 * (suggest-field.ts). Nothing converts by itself: `sol` stays three letters,
 * so `solution1` can be typed in peace.
 *
 * Order: names defined in the notebook (nearest above the caret first), then
 * functions in sidebar order (everyday ones before "More"), then Greek letters.
 */
import type { CatalogItem } from "../ui/commands";

export type Suggestion = {
  /** What is typed: `solve`, `theta`, `area`. */
  name: string;
  /** What Tab puts in place of the typed letters. */
  latex: string;
  /** How it reads, from the name on: `solve(…, x)`, `area(r)`. */
  hint: string;
  /** What it turns into, when that is not the name itself: `θ`. */
  symbol?: string;
  /** Defined in the notebook: typing the whole name needs no suggestion. */
  own?: boolean;
};

const GREEK: [string, string][] = [
  ["alpha", "α"], ["beta", "β"], ["gamma", "γ"], ["Gamma", "Γ"], ["delta", "δ"], ["Delta", "Δ"],
  ["epsilon", "ε"], ["theta", "θ"], ["Theta", "Θ"], ["lambda", "λ"], ["mu", "μ"], ["pi", "π"], ["Pi", "Π"],
  ["rho", "ρ"], ["sigma", "σ"], ["Sigma", "Σ"], ["tau", "τ"], ["phi", "φ"], ["Phi", "Φ"], ["omega", "ω"], ["Omega", "Ω"],
];

/** Greek letters, ∞, the templates typed by name, and the word that ends a piecewise function. */
export const SYMBOLS: Suggestion[] = [
  { name: "sqrt", latex: "\\sqrt{\\placeholder{}}", hint: "sqrt", symbol: "√" },
  { name: "int", latex: "\\int \\placeholder{}\\,\\differentialD x", hint: "int", symbol: "∫ … dx" },
  { name: "lim", latex: "\\lim_{x\\to\\placeholder{}}\\placeholder{}", hint: "lim", symbol: "lim x→a" },
  { name: "sum", latex: "\\sum_{k=1}^{\\placeholder{}}\\placeholder{}", hint: "sum", symbol: "Σ" },
  { name: "prod", latex: "\\prod_{k=1}^{\\placeholder{}}\\placeholder{}", hint: "prod", symbol: "Π" },
  ...GREEK.map(([name, symbol]) => ({ name, latex: `\\${name}`, hint: name, symbol })),
  { name: "infinity", latex: "\\infty", hint: "infinity", symbol: "∞" },
  { name: "oo", latex: "\\infty", hint: "oo", symbol: "∞" },
  { name: "otherwise", latex: "\\text{otherwise}", hint: "otherwise" },
  { name: "restart", latex: "\\operatorname{restart}", hint: "restart" },
];

/** A box where the template says "the selection or a box". */
const boxes = (latex: string) => latex.replace(/#0|#@/g, "\\placeholder{}");

/** The catalog's functions, one per name, as they are typed (`solve(…, x)`). */
export function functionSuggestions(catalog: CatalogItem[]): Suggestion[] {
  const items = [...catalog.filter((c) => !c.advanced), ...catalog.filter((c) => c.advanced)];
  const seen = new Set<string>();
  const out: Suggestion[] = [];
  for (const item of items) {
    const name = item.syntax?.match(/^([A-Za-z]+)\(/)?.[1];
    if (!name || seen.has(name) || !item.latex) continue;
    seen.add(name);
    out.push({ name, latex: boxes(item.latex), hint: item.syntax! });
  }
  return out;
}

/**
 * A name the notebook defines, from its Giac form: `area(r,h):=…` is a
 * function, `solution1:=…` a variable. Only plain names of two or more
 * characters; others can't be typed as a run of letters.
 */
export function definedSuggestion(name: string, params?: string[]): Suggestion | null {
  if (!/^[A-Za-z][A-Za-z0-9]+$/.test(name)) return null;
  if (!params) return { name, latex: name, hint: name, own: true };
  const args = params.map(() => "\\placeholder{}").join(",");
  return { name, latex: `${name}\\left(${args || "\\placeholder{}"}\\right)`, hint: `${name}(${params.join(", ")})`, own: true };
}

/** The best suggestion for the letters before the caret, or null. */
export function suggest(typed: string, lists: Suggestion[][]): Suggestion | null {
  if (typed.length < 2) return null;
  for (const list of lists) {
    for (const s of list) {
      if (!s.name.startsWith(typed)) continue;
      // A whole name of your own needs nothing; a whole function or
      // Greek name still converts on Tab (pi → π, sin → sin(…)).
      if (s.name === typed && s.own && s.latex === s.name) continue;
      return s;
    }
  }
  return null;
}

/** The grey text after the caret: the rest of the hint, then the symbol. */
export function ghostText(typed: string, s: Suggestion): string {
  const rest = s.hint.slice(typed.length);
  return s.symbol ? `${rest} ${s.symbol}` : rest;
}
