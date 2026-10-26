/**
 * A result as plain text for the clipboard (Ctrl+Shift+C), from MathLive's
 * AsciiMath: it quotes text ("or"), brackets every fraction part
 * ((1)/(2)) and escapes braces. Tidy those up so the text reads as typed.
 */
export function tidyAsciiMath(ascii: string): string {
  let s = ascii
    .replace(/"\s*([^"]*?)\s*"/g, " $1 ") // " or " → or
    .replace(/\\([{}])/g, "$1"); // \{2, 3\} → {2, 3}
  // (1)/(2) → 1/2, but (x+1)/(x-1) keeps its brackets.
  s = s.replace(/\(([\w.]+)\)\/\(([\w.]+)\)/g, "$1/$2");
  s = s.replace(/\(([\w.]+)\)\//g, "$1/").replace(/\/\(([\w.]+)\)/g, "/$1");
  return s.replace(/\s+/g, " ").trim();
}
