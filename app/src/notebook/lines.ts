// A cell can hold several lines (Shift+Enter). MathLive stores them as
// \displaylines{a\\ b}, or as a bare a\\ b after a value was set and read
// back; both load as the same multi-line field.

/** Splits a cell's LaTeX into its lines. A "\\" inside braces or an environment (a matrix row) does not count. */
export function splitLines(latex: string): string[] {
  let body = latex.trim();
  const wrapped = body.match(/^\\displaylines\s*\{([\s\S]*)\}$/);
  if (wrapped && closesAtEnd(body, body.indexOf("{"))) body = wrapped[1];

  const lines: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (c === "\\") {
      if (body.startsWith("\\begin", i)) depth++;
      else if (body.startsWith("\\end", i)) depth--;
      else if (body[i + 1] === "\\" && depth === 0) {
        lines.push(body.slice(start, i).trim());
        start = i + 2;
      }
      i++; // skip the escaped character, e.g. \{ or the second \ of \\
      continue;
    }
    if (c === "{") depth++;
    else if (c === "}") depth--;
  }
  lines.push(body.slice(start).trim());
  return lines;
}

/** True when the brace opening at `open` is closed by the string's last character. */
function closesAtEnd(s: string, open: number): boolean {
  let depth = 0;
  for (let i = open; i < s.length; i++) {
    if (s[i] === "\\") {
      i++;
      continue;
    }
    if (s[i] === "{") depth++;
    else if (s[i] === "}" && --depth === 0) return i === s.length - 1;
  }
  return false;
}

/** A line that starts with # is text: shown, never evaluated. */
export function isTextLine(line: string): boolean {
  return /^(\\text\{\s*)?\\#/.test(line.trim());
}

/**
 * Builds cell LaTeX for plain text, one text line per text line. Used to
 * convert notes saved by the short-lived separate text blocks.
 */
export function textToLatex(text: string): string {
  const escape = (s: string) =>
    s.replace(/[\\{}#$%&_^~]/g, (c) =>
      c === "\\" ? "\\textbackslash{}" : c === "^" ? "\\textasciicircum{}" : c === "~" ? "\\textasciitilde{}" : `\\${c}`,
    );
  const lines = text.split("\n").map((l) => `\\text{\\# ${escape(l)}}`);
  return lines.length > 1 ? `\\displaylines{${lines.join("\\\\ ")}}` : lines[0];
}
