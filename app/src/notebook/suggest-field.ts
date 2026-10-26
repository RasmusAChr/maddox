import type { MathfieldElement } from "mathlive";
import { caretRect } from "./mathlive-internals";
import { ghostText, suggest, type Suggestion } from "./suggestions";

/** The letters typed together just before the caret, and where they start; null if none. */
function typedWord(mf: MathfieldElement): { text: string; start: number } | null {
  if (mf.mode !== "math") return null;
  const [range] = mf.selection.ranges;
  if (!range || range[0] !== range[1]) return null;
  const end = mf.position;
  let word: { text: string; start: number } | null = null;
  for (let start = end - 1; start >= 0 && end - start <= 40; start--) {
    const text = mf.getValue(start, end, "latex");
    // One character per atom: an invisible atom (MathLive leaves some after
    // the := shortcut) serialises as nothing and ends the word.
    if (text.length !== end - start) break;
    if (!/^[A-Za-z][A-Za-z0-9]*$/.test(text)) {
      if (!/^[A-Za-z0-9]+$/.test(text)) break; // a digit may be inside a name: solution1
      continue;
    }
    word = { text, start };
  }
  return word;
}

/** One grey line of text for every field; only the focused one shows it. */
let ghost: HTMLElement | null = null;
function ghostEl(): HTMLElement {
  if (!ghost) {
    ghost = document.createElement("div");
    ghost.className = "suggestion-ghost";
    ghost.setAttribute("aria-hidden", "true");
    ghost.hidden = true;
    document.body.append(ghost);
  }
  return ghost;
}

/**
 * Grey suggestions in a math field (suggestions.ts): after two letters, the
 * best name that starts with them shows after the caret. Tab takes it,
 * replacing the letters; Esc hides it until the next letter. Register this
 * before the field's other keydown handlers, so Tab and Esc go here first.
 */
export function attachSuggestions(mf: MathfieldElement, lists: () => Suggestion[][], onAccept: () => void = () => {}) {
  let current: { start: number; suggestion: Suggestion } | null = null;
  let dismissedAt = -1;

  const hide = () => {
    current = null;
    ghostEl().hidden = true;
  };

  const update = () => {
    const word = mf.hasFocus() ? typedWord(mf) : null;
    const suggestion = word && mf.position !== dismissedAt ? suggest(word.text, lists()) : null;
    if (!word || !suggestion) return hide();
    // Tab works at once; the grey text waits for MathLive to draw the caret.
    current = { start: word.start, suggestion };
    const text = ghostText(word.text, suggestion);
    requestAnimationFrame(() => {
      const caret = caretRect(mf);
      const el = ghostEl();
      if (current?.suggestion !== suggestion || !caret) return;
      el.textContent = text;
      el.style.left = `${caret.right + 1}px`;
      el.style.top = `${caret.top}px`;
      el.style.height = `${caret.height}px`;
      el.style.lineHeight = `${caret.height}px`;
      el.style.fontSize = getComputedStyle(mf).fontSize;
      el.hidden = false;
    });
  };

  mf.addEventListener("input", () => {
    dismissedAt = -1;
    update();
  });
  mf.addEventListener("selection-change", () => requestAnimationFrame(update));
  mf.addEventListener("focus", () => requestAnimationFrame(update));
  mf.addEventListener("blur", hide);
  // A scroll would leave the grey text where the caret was.
  window.addEventListener("scroll", () => current && update(), { capture: true, passive: true });

  mf.addEventListener("keydown", (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
    if (e.key === "Tab") {
      // The field as it is now, not the last update: MathLive's "input" for
      // the last letter may not have arrived yet (sin typed fast would still
      // suggest simplify, or nothing).
      const word = mf.position === dismissedAt ? null : typedWord(mf);
      const suggestion = word && suggest(word.text, lists());
      if (!word || !suggestion) return hide();
      e.preventDefault();
      e.stopImmediatePropagation();
      const { start } = word;
      hide();
      onAccept();
      mf.selection = { ranges: [[start, mf.position]], direction: "forward" };
      // No focus option: the field has it, and MathLive's delayed refocus
      // could swallow the keys typed right after Tab.
      mf.insert(suggestion.latex, { selectionMode: "placeholder" });
    } else if (e.key === "Escape" && current) {
      e.preventDefault();
      e.stopImmediatePropagation();
      dismissedAt = mf.position;
      hide();
    }
  }, { capture: true });
}
