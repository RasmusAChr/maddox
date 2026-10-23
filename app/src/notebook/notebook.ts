import { MathfieldElement, convertLatexToMarkup } from "mathlive";
import type { Engine } from "../engine/engine";
import type { AnswerMode, EvalResult } from "../engine/giac-session";
import { latexToGiac, UnsupportedLatex } from "../engine/latex-to-giac";
import { OPERATOR_NAMES } from "../ui/commands";
import { isTextLine, splitLines } from "./lines";
import { editMatrix, matrixAtCaret, matrixLatex, type MatrixAction, type MatrixInfo } from "./matrix";
import { atLineStart, breakLine, deleteAtBrackets, fillEmptyMatrixCells, focusImmediately, lineBoxes, moveByWord, type LineBox } from "./mathlive-internals";

/** What one line of a cell shows on the right: nothing (text or empty line), a result, or "computing". */
type LineResult = EvalResult | "pending" | null;

type Entry = {
  el: HTMLElement;
  mf: MathfieldElement;
  resultEl: HTMLElement;
  /** The input the shown results belong to; null when nothing was run. */
  evaluatedLatex: string | null;
  results: LineResult[];
  /** Set when Alt+Enter switched this cell away from the global answer mode. */
  answers: Answers | null;
  /** The ≈ marker shown while `answers` is set. */
  chip: HTMLElement;
};

/** A cell's own answer form, overriding the global setting. */
export type Answers = "exact" | "approx";

/** One cell as saved: its input, and its own answer form if it has one. */
export type Cell = { latex: string; answers?: Answers };

// Shortcuts MathLive applies while typing. Its defaults include surprises for
// a calculator (e.g. "in" becomes ∈), so start from a short allowlist.
const KEPT_SHORTCUTS = [
  "alpha", "delta", "Delta", "pi", "Pi", "theta", "Theta", "infty", "oo",
  "sqrt", "int", "sum", "prod", "lim", "dx", "dy", "dt",
  "sin", "cos", "tan", "arcsin", "arccos", "arctan", "sinh", "cosh", "tanh", "cot", "sec", "csc",
  "ln", "<=", ">=", "!=", ":=",
  "deg", // after a number: 30deg becomes 30°
];
const EXTRA_SHORTCUTS: Record<string, string> = {
  log: "\\log", // MathLive's default asks for a base; log is base 10 here.
  beta: "\\beta", gamma: "\\gamma", lambda: "\\lambda", mu: "\\mu", sigma: "\\sigma",
  omega: "\\omega", phi: "\\phi", epsilon: "\\epsilon", rho: "\\rho", tau: "\\tau",
};

const MATRIX_KEYS: Record<string, MatrixAction> = {
  ArrowUp: "addRowAbove",
  ArrowDown: "addRowBelow",
  ArrowLeft: "addColumnLeft",
  ArrowRight: "addColumnRight",
};

export type Context = { matrix: MatrixInfo | null };

/** Minimum space, in px, between the results of one multi-line cell. */
const RESULT_GAP = 8;

// Injected into each math-field's shadow root: text lines (# …) read as
// headings. MathLive renders every text-mode character as span.ML__text.
const FIELD_CSS = `.ML__text { font-weight: 600; letter-spacing: 0.005em; }`;

export class Notebook {
  private entries: Entry[] = [];
  private active: Entry | null = null;
  private shortcuts: Record<string, any> | null = null;
  /** The global answer mode (settings); Alt+Enter switches a cell to the other form. */
  answerMode: AnswerMode = "auto";
  private resizeObserver = new ResizeObserver((records) => {
    for (const r of records) {
      const entry = this.entries.find((e) => e.el === r.target);
      if (entry) this.layoutResults(entry);
    }
  });

  /** The entries' text changed (for the unsaved marker and autosave). */
  onChange: () => void = () => {};
  /** The caret moved into or out of a matrix. */
  onContext: (ctx: Context) => void = () => {};
  /** A message for the status bar. */
  onMessage: (text: string) => void = () => {};

  constructor(private container: HTMLElement, private engine: Engine) {
    // Positions measured before the maths fonts arrive are wrong; redo them.
    document.fonts?.addEventListener("loadingdone", () => this.relayout());
    void document.fonts?.ready.then(() => this.relayout());
    engine.onRestart = () => {
      for (const e of this.entries) if (e.evaluatedLatex !== null) e.el.classList.add("stale");
      this.onMessage("Cancelled. The engine restarted, so variables were cleared — Ctrl+Shift+Enter re-runs everything.");
    };
  }

  /** Re-places every result and leader (after fonts load or a zoom). */
  relayout() {
    for (const entry of this.entries) this.layoutResults(entry);
  }

  get latexList(): string[] {
    return this.entries.map((e) => e.mf.value);
  }

  get cells(): Cell[] {
    return this.entries.map((e) => (e.answers ? { latex: e.mf.value, answers: e.answers } : { latex: e.mf.value }));
  }

  /** Replaces every entry. Always leaves at least one. */
  load(cells: Cell[]) {
    for (const e of this.entries) this.resizeObserver.unobserve(e.el);
    this.container.replaceChildren();
    this.entries = [];
    this.active = null;
    const list = cells.length ? cells : [{ latex: "" }];
    list.forEach((cell, i) => this.createEntry(cell.latex, i, cell.answers ?? null));
  }

  /**
   * Alt+Enter: the cell shows the other form of its answers (decimals, or
   * exact ones when the global setting is "Decimals only"), or goes back to
   * the global setting. Saved with the cell; re-runs it.
   */
  toggleAnswers(entry = this.active ?? this.entries[this.entries.length - 1]) {
    entry.answers = entry.answers ? null : this.answerMode === "approx" ? "exact" : "approx";
    this.showAnswersChip(entry);
    this.onMessage(
      entry.answers === "approx" ? "This cell shows decimals. Alt+Enter switches back."
        : entry.answers === "exact" ? "This cell shows exact answers. Alt+Enter switches back."
        : "This cell follows the answers setting again.",
    );
    this.onChange();
    focusImmediately(entry.mf);
    void this.evaluate(entry);
  }

  private showAnswersChip(entry: Entry) {
    entry.chip.hidden = !entry.answers;
    entry.chip.textContent = entry.answers === "exact" ? "=" : "≈";
    entry.chip.title = entry.answers === "exact"
      ? "This cell shows exact answers (Alt+Enter switches back)"
      : "This cell shows decimals (Alt+Enter switches back)";
  }

  focusLast() {
    this.focus(this.entries[this.entries.length - 1], "end");
  }

  /** A click on empty notebook space: the entry it hit (or the last one) gets the caret at its end. */
  focusFromClick(target: Element) {
    const el = target.closest(".entry");
    const entry = this.entries.find((e) => e.el === el) ?? this.entries[this.entries.length - 1];
    this.focus(entry, "end");
  }

  /** Returns focus to the entry being edited, caret unchanged. */
  refocus() {
    focusImmediately((this.active ?? this.entries[this.entries.length - 1]).mf);
  }

  /** Inserts LaTeX at the caret of the entry being edited. */
  insert(latex: string) {
    const entry = this.active ?? this.entries[this.entries.length - 1];
    focusImmediately(entry.mf);
    entry.mf.insert(latex, { selectionMode: "placeholder", focus: true });
    this.emitContext(entry);
  }

  insertMatrix(rows: number, cols: number) {
    this.insert(matrixLatex(rows, cols));
  }

  async runAll() {
    if (this.engine.status === "failed") return;
    await this.engine.reset();
    for (const entry of [...this.entries]) {
      if (!this.entries.includes(entry)) continue;
      await this.evaluate(entry);
    }
  }

  // ---- entries ------------------------------------------------------------

  private createEntry(latex: string, index: number, answers: Answers | null = null): Entry {
    const el = document.createElement("div");
    el.className = "entry";
    const mf = new MathfieldElement();
    mf.className = "entry-input";
    const resultEl = document.createElement("div");
    resultEl.className = "entry-result";
    resultEl.setAttribute("aria-live", "polite");
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "answers-chip";
    chip.addEventListener("mousedown", (e) => e.preventDefault()); // keep focus in the cell
    el.append(mf, resultEl, chip);

    const entry: Entry = { el, mf, resultEl, evaluatedLatex: null, results: [], answers, chip };
    chip.addEventListener("click", () => this.toggleAnswers(entry));
    this.showAnswersChip(entry);
    const next = this.entries[index];
    this.container.insertBefore(el, next ? next.el : null);
    this.entries.splice(index, 0, entry);
    // MathLive rejects option access until the field is in the document.
    this.configure(mf);
    const style = document.createElement("style");
    style.textContent = FIELD_CSS;
    mf.shadowRoot?.append(style);
    mf.value = latex;
    fillEmptyMatrixCells(mf);
    this.resizeObserver.observe(el);

    mf.addEventListener("keydown", (e) => this.onKeyDown(entry, e), { capture: true });
    mf.addEventListener("move-out", (e) => this.onMoveOut(entry, e as CustomEvent));
    mf.addEventListener("focus", () => {
      this.active = entry;
      this.emitContext(entry);
    });
    mf.addEventListener("selection-change", () => this.emitContext(entry));
    mf.addEventListener("input", () => {
      // Deleting a matrix cell's content (or its box) leaves it empty; refill it.
      fillEmptyMatrixCells(mf);
      el.classList.toggle("stale", entry.evaluatedLatex !== null && mf.value !== entry.evaluatedLatex);
      // Lines move as you type; keep results and leader dots beside them.
      requestAnimationFrame(() => this.layoutResults(entry));
      this.onChange();
    });
    return entry;
  }

  private configure(mf: MathfieldElement) {
    if (!this.shortcuts) {
      const defaults = mf.inlineShortcuts as Record<string, any>;
      const kept = Object.fromEntries(KEPT_SHORTCUTS.filter((k) => k in defaults).map((k) => [k, defaults[k]]));
      const names = Object.fromEntries(OPERATOR_NAMES.map((n) => [n, `\\operatorname{${n}}`]));
      this.shortcuts = { ...kept, ...EXTRA_SHORTCUTS, ...names };
    }
    mf.inlineShortcuts = this.shortcuts;
    mf.smartFence = true;
    mf.mathVirtualKeyboardPolicy = "manual";
    // Matrix editing goes through our own Alt+arrow keys. MathLive's own
    // add-row bindings (Ctrl/Alt+Enter, Alt+Tab) also turn a plain expression
    // into a matrix by surprise, so drop them all.
    // Esc is "cancel computation" here; MathLive would open raw-LaTeX mode
    // (typing \ still does, and Esc still leaves it).
    mf.keybindings = mf.keybindings.filter((kb) => {
      const command = Array.isArray(kb.command) ? kb.command[0] : kb.command;
      if (typeof command === "string" && /^(addRow|addColumn)/.test(command)) return false;
      return !(kb.key === "[Escape]" && (kb.ifMode === "math" || kb.ifMode === "text"));
    });
  }

  private removeEntry(entry: Entry) {
    const index = this.entries.indexOf(entry);
    if (index < 0 || this.entries.length === 1) return;
    this.resizeObserver.unobserve(entry.el);
    entry.el.remove();
    this.entries.splice(index, 1);
    if (this.active === entry) this.active = null;
    this.focus(this.entries[Math.max(0, index - 1)], index > 0 ? "end" : "start");
    this.onChange();
  }

  private insertEntryAfter(entry: Entry): Entry {
    const created = this.createEntry("", this.entries.indexOf(entry) + 1);
    this.focus(created, "start");
    this.onChange();
    return created;
  }

  private focus(entry: Entry | undefined, where: "start" | "end") {
    if (!entry) return;
    this.active = entry;
    const attempt = () => {
      focusImmediately(entry.mf);
      entry.mf.executeCommand(where === "start" ? "moveToMathfieldStart" : "moveToMathfieldEnd");
    };
    ensureFocused(entry.mf, attempt);
    entry.el.scrollIntoView({ block: "nearest" });
  }

  // ---- keys ---------------------------------------------------------------

  // Registered in the capture phase on the math-field host, so it runs before
  // MathLive's own handler inside the shadow DOM and can claim a key outright.
  private onKeyDown(entry: Entry, e: KeyboardEvent) {
    const claim = () => {
      e.preventDefault();
      e.stopPropagation();
    };
    const mod = e.ctrlKey || e.metaKey;

    if (e.key === "Enter" && e.altKey && !mod && !e.shiftKey) {
      claim();
      this.toggleAnswers(entry);
      return;
    }

    if (e.key === "Enter" && !e.altKey) {
      if (mod && e.shiftKey) return; // run all: handled globally
      claim();
      if (mod) this.insertEntryAfter(entry);
      else if (e.shiftKey) breakLine(entry.mf);
      else void this.evaluateAndAdvance(entry);
      return;
    }

    // "#" at the start of a line makes that line text. The # is typed again
    // in text mode so it stays visible as the marker (and works on keyboard
    // layouts where MathLive has no text-mode key).
    if (e.key === "#" && !mod && !e.altKey && entry.mf.mode === "math" && atLineStart(entry.mf)) {
      claim();
      entry.mf.executeCommand(["switchMode", "text"]);
      entry.mf.executeCommand(["typedText", "#"]);
      return;
    }

    if ((e.key === "ArrowLeft" || e.key === "ArrowRight") && mod && !e.altKey) {
      claim();
      moveByWord(entry.mf, e.key === "ArrowLeft" ? "left" : "right", e.shiftKey);
      this.emitContext(entry);
      return;
    }

    if (e.altKey && !mod && e.key in MATRIX_KEYS) {
      const vertical = e.key === "ArrowUp" || e.key === "ArrowDown";
      const action = e.shiftKey ? (vertical ? "removeRow" : "removeColumn") : MATRIX_KEYS[e.key];
      if (editMatrix(entry.mf, action)) {
        claim();
        this.emitContext(entry);
      }
      return;
    }

    // Deleting a matrix cell's box fires no "input" event, so check after
    // every deletion too.
    if (e.key === "Backspace" || e.key === "Delete") requestAnimationFrame(() => fillEmptyMatrixCells(entry.mf));

    if ((e.key === "Backspace" || e.key === "Delete") && !e.shiftKey && !e.altKey && deleteAtBrackets(entry.mf, e.key, mod)) {
      claim();
      return;
    }

    if (e.key === "Backspace" && mod && e.shiftKey) {
      claim();
      this.removeEntry(entry);
      return;
    }
    if (e.key === "Backspace" && !mod && entry.mf.value === "" && this.entries.length > 1) {
      claim();
      this.removeEntry(entry);
      return;
    }

    if ((e.key === "ArrowUp" || e.key === "ArrowDown") && !e.shiftKey && !mod && !e.altKey) {
      // WebKitGTK (Linux) does not reliably fire "move-out" at the top or
      // bottom row, so also move when the caret provably did not move.
      const direction = e.key === "ArrowUp" ? "upward" : "downward";
      const before = entry.mf.position;
      this.movedOut = null;
      requestAnimationFrame(() => {
        if (this.movedOut === direction || entry.mf.position !== before) return;
        this.moveFrom(entry, direction);
      });
    }
  }

  private movedOut: "upward" | "downward" | null = null;

  private onMoveOut(entry: Entry, e: CustomEvent<{ direction: string }>) {
    const direction = e.detail.direction;
    if (direction !== "upward" && direction !== "downward") return;
    e.preventDefault();
    this.movedOut = direction;
    this.moveFrom(entry, direction);
  }

  private moveFrom(entry: Entry, direction: "upward" | "downward") {
    const index = this.entries.indexOf(entry);
    if (direction === "upward") this.focus(this.entries[index - 1], "end");
    else this.focus(this.entries[index + 1], "start");
  }

  private emitContext(entry: Entry) {
    if (entry !== this.active) return;
    this.onContext({ matrix: matrixAtCaret(entry.mf) });
  }

  // ---- evaluation ---------------------------------------------------------

  private async evaluateAndAdvance(entry: Entry) {
    const index = this.entries.indexOf(entry);
    const next = this.entries[index + 1];
    // Like a calculator: Enter on the last entry opens a fresh one.
    if (next) this.focus(next, "end");
    else if (entry.mf.value.trim()) this.insertEntryAfter(entry);
    await this.evaluate(entry);
  }

  /** Evaluates every maths line of the cell in order; text and empty lines get no result. */
  private async evaluate(entry: Entry) {
    const latex = entry.mf.value;
    const lines = splitLines(latex);
    entry.evaluatedLatex = latex;
    entry.el.classList.remove("stale");
    entry.results = lines.map((line) => (line && !isTextLine(line) ? "pending" : null));
    this.renderResults(entry);

    for (let i = 0; i < lines.length; i++) {
      if (entry.results[i] !== "pending") continue;
      let result: EvalResult;
      try {
        result = await this.engine.evaluate(latexToGiac(lines[i]), entry.answers ?? undefined);
      } catch (err) {
        if (!(err instanceof UnsupportedLatex)) throw err;
        result = { ok: false, error: err.message };
      }
      if (!this.entries.includes(entry) || entry.evaluatedLatex !== latex) return;
      entry.results[i] = result;
      this.renderResults(entry);
    }
    entry.el.classList.toggle("stale", entry.mf.value !== latex);
  }

  private renderResults(entry: Entry) {
    const r = entry.resultEl;
    r.replaceChildren();
    entry.el.classList.toggle("has-error", entry.results.some((x) => x !== null && x !== "pending" && !x.ok));
    entry.results.forEach((result) => {
      const row = document.createElement("div");
      row.className = "result-line";
      r.append(row);
      if (result === null) return;
      if (result === "pending") {
        row.classList.add("pending");
        row.textContent = "…";
        return;
      }
      if (!result.ok) {
        const msg = document.createElement("span");
        msg.className = "error";
        msg.textContent = result.error;
        row.append(msg);
        return;
      }
      const exact = document.createElement("span");
      exact.className = "exact";
      exact.innerHTML = convertLatexToMarkup(result.latex);
      exact.dataset.latex = result.latex;
      exact.title = "Click to paste into the entry you are editing";
      exact.addEventListener("click", () => this.paste(result.latex, entry));
      row.append(exact);
      if (result.approxLatex) {
        const approx = document.createElement("span");
        approx.className = "approx";
        approx.innerHTML = `<span class="approx-sign">≈</span>${convertLatexToMarkup(result.approxLatex)}`;
        row.append(approx);
      }
    });
    this.layoutResults(entry);
  }

  /**
   * Places results without ever scrolling the result column:
   * - A one-line cell: flexbox centres the result on the input, and the cell
   *   grows to fit a tall result.
   * - A multi-line cell: each result is centred on its own line. A result
   *   taller than the room it has pushes the following ones down.
   * - If the results don't fit beside the input, the flex row wraps them onto
   *   a full-width row below it, where they simply stack.
   * - A single result wider than the whole cell gets its own sideways scroll
   *   ("wide"), the last resort.
   */
  private layoutResults(entry: Entry) {
    const rows = [...entry.resultEl.children] as HTMLElement[];
    for (const row of rows) {
      row.style.marginTop = "";
      row.classList.remove("wide");
    }
    for (const leader of entry.el.querySelectorAll(".leader")) leader.remove();
    const multi = rows.length > 1;
    entry.el.classList.toggle("multi-line", multi);
    if (!rows.length) return;

    const boxes = lineBoxes(entry.mf);
    const mfRect = entry.mf.getBoundingClientRect();
    const top = entry.resultEl.getBoundingClientRect().top;
    const wrapped = top >= mfRect.bottom - 1;
    if (multi && !wrapped && boxes.length === rows.length) {
      let y = top;
      rows.forEach((row, i) => {
        const height = row.offsetHeight;
        const center = (boxes[i].top + boxes[i].bottom) / 2;
        // A little air between results, so stacked matrices don't touch.
        const rowTop = Math.max(i ? y + RESULT_GAP : y, center - height / 2);
        row.style.marginTop = `${rowTop - y}px`;
        y = rowTop + height;
      });
    }
    // Compare with the whole cell, not the row: glyphs that overhang by a
    // pixel would otherwise flag ordinary results as too wide.
    const style = getComputedStyle(entry.el);
    const cellWidth = entry.el.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
    for (const row of rows) row.classList.toggle("wide", row.scrollWidth > cellWidth + 1);
    if (!wrapped && boxes.length === rows.length) this.drawLeaders(entry, rows, boxes);
  }

  /**
   * Faint dotted leaders from the end of each input line to its result, so
   * the eye can follow a line across a wide sheet (as in a table of contents).
   * Skipped where there is little gap, or a result was pushed off its line.
   */
  private drawLeaders(entry: Entry, rows: HTMLElement[], boxes: LineBox[]) {
    const origin = entry.el.getBoundingClientRect();
    const left = origin.left + entry.el.clientLeft;
    rows.forEach((row, i) => {
      const content = row.firstElementChild as HTMLElement | null;
      if (!content || row.classList.contains("pending") || row.classList.contains("wide")) return;
      const box = boxes[i];
      const rowRect = row.getBoundingClientRect();
      const rowCenter = (rowRect.top + rowRect.bottom) / 2;
      // One line: the result is centred on it by flexbox, so follow the
      // result (inputs like ∫ with limits are not symmetric). Several lines:
      // skip a result that was pushed off its line by a taller one above.
      const lineCenter = rows.length === 1 ? rowCenter : (box.top + box.bottom) / 2;
      if (Math.abs(rowCenter - lineCenter) > 4) return;
      const x1 = box.right + 16;
      const x2 = content.getBoundingClientRect().left - 16;
      if (x2 - x1 < 32) return;
      const leader = document.createElement("div");
      leader.className = "leader";
      leader.setAttribute("aria-hidden", "true");
      leader.style.left = `${x1 - left}px`;
      leader.style.width = `${x2 - x1}px`;
      leader.style.top = `${lineCenter - origin.top - entry.el.clientTop}px`;
      entry.el.append(leader);
    });
  }

  /** Pastes a result into the entry being edited (or the last one). */
  private paste(latex: string, from: Entry) {
    const target = this.active && this.active !== from ? this.active : this.entries[this.entries.length - 1];
    focusImmediately(target.mf);
    target.mf.insert(latex, { focus: true });
  }
}

/**
 * Retries focusing until `target` has focus. On WebKitGTK, focusing a
 * math-field right after a sibling was removed can throw inside MathLive or
 * land on <body>, recovering only after tens of milliseconds.
 */
function ensureFocused(target: HTMLElement, attempt: () => void, attemptsLeft = 5, delay = 20) {
  try {
    attempt();
  } catch {
    // retried below
  }
  if (document.activeElement === target || attemptsLeft <= 1) return;
  setTimeout(() => ensureFocused(target, attempt, attemptsLeft - 1, delay * 2), delay);
}
