// What Ctrl+Shift+G adds to a graph tab from a cell line (LaTeX in, LaTeX
// out), and how a graph-panel row reads (Giac in).
import { CALL_OR_PRODUCT } from "../engine/latex-to-giac";
import { isTextLine } from "./lines";

/** Names a graph tab defines live in Giac under this prefix, so they never touch the notebook's. */
export const LOCAL = "maddox_local_";

/**
 * A graph-panel row: g(x) = … or a = … defines a name for that tab only
 * (decision 0008); y = … and anything else is drawn or, without x, shown
 * as a value. := would define for the whole notebook, which only a cell does.
 */
export type PanelRow =
  | { kind: "function"; name: string; param: string; body: string }
  | { kind: "value"; name: string; body: string }
  | { kind: "expression"; body: string }
  | { kind: "error"; error: string };

const NAME = "[A-Za-z][A-Za-z0-9_]*";

/** The top-level position of `op` (":=" or a lone "="), or -1. */
function topLevel(giac: string, op: ":=" | "="): number {
  let depth = 0;
  for (let i = 0; i < giac.length; i++) {
    const c = giac[i];
    if ("([{".includes(c)) depth++;
    else if (")]}".includes(c)) depth--;
    else if (depth === 0 && op === ":=" && giac.startsWith(":=", i)) return i;
    else if (depth === 0 && op === "=" && c === "=" && !"<>!:=".includes(giac[i - 1] ?? "") && giac[i + 1] !== "=") return i;
  }
  return -1;
}

export function readPanelRow(giac: string): PanelRow {
  const text = giac.replaceAll(CALL_OR_PRODUCT, "").trim();
  const assign = topLevel(text, ":=");
  if (assign >= 0) {
    const name = text.slice(0, assign).match(new RegExp(`^(${NAME})`))?.[1] ?? "it";
    return { kind: "error", error: `Use = to define ${name} in this graph. Define ${name} globally using := in the notebook.` };
  }
  const eq = topLevel(text, "=");
  if (eq < 0) return { kind: "expression", body: text };
  const left = text.slice(0, eq).trim();
  const body = text.slice(eq + 1).trim();
  if (!body) return { kind: "error", error: "Write what it equals after =" };
  const fn = left.match(new RegExp(`^(${NAME})\\((${NAME})\\)$`));
  if (fn) return { kind: "function", name: fn[1], param: fn[2], body };
  if (left === "y") return { kind: "expression", body };
  if (left === "x") return { kind: "error", error: "x is the graph's variable; write y = … or g(x) = …" };
  if (new RegExp(`^${NAME}$`).test(left)) return { kind: "value", name: left, body };
  return { kind: "error", error: "Write g(x) = … to define a function here, or y = … to draw one" };
}

/** Names (g, a) in Giac text, renamed to their local form: the tab's, or an inline graph's sliders'. */
export function localise(giac: string, names: Iterable<string>, prefix = LOCAL): string {
  let out = giac;
  for (const name of names) out = out.replace(new RegExp(`(?<![A-Za-z0-9_])${name}(?![A-Za-z0-9_])`, "g"), prefix + name);
  return out;
}

/** LaTeX that Giac wrote for a localised name (maddox_s1_a, maddox_local_g) back to the name as typed. */
export function unlocalise(latex: string): string {
  return latex
    .replace(/\\mathrm\{maddox\\_(?:local|s\d+)\\_([A-Za-z0-9\\_]+)\}/g, (_m, name: string) => name.replaceAll("\\_", "_"))
    .replace(/maddox\\?_(?:local|s\d+)\\?_/g, "");
}

/** Splits LaTeX on commas outside {…} and \left…\right. */
export function splitLatexArgs(latex: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < latex.length; i++) {
    if (latex.startsWith("\\left", i)) {
      depth++;
      i += 4;
    } else if (latex.startsWith("\\right", i)) {
      depth--;
      i += 5;
    } else if (latex[i] === "{") depth++;
    else if (latex[i] === "}") depth--;
    else if (latex[i] === "," && depth === 0) {
      parts.push(latex.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(latex.slice(start));
  return parts.map((p) => p.trim()).filter(Boolean);
}

/**
 * f(x) := … adds f; D := … adds D; plot(f, g) adds f and g; text adds
 * nothing; anything else adds the line itself (x² − 2).
 */
export function plotItemsFromLine(line: string): string[] {
  const latex = line.trim();
  if (!latex || isTextLine(latex)) return [];
  // \operatorname{plot} from Tab or a template; plain letters when typed.
  const plot = latex.match(/^(?:\\operatorname\{(?:\\mathrm\{)?plot\}+|plot)\\left\((.*)\\right\)$/s);
  if (plot) return splitLatexArgs(plot[1]);
  const definition = latex.match(/^(.+?)(?:\\coloneq|:=)/s);
  if (definition) {
    const name = definition[1].trim().match(/^([A-Za-z][A-Za-z0-9]*(?:_\{?[A-Za-z0-9]+\}?)?)\s*(?:\\left\(.*\\right\))?$/s);
    return name ? [name[1]] : [];
  }
  return [latex];
}
