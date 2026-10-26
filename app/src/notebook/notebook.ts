import { MathfieldElement, convertLatexToMarkup } from "mathlive";
import type { Engine } from "../engine/engine";
import type { AnswerMode, EvalResult, PlotResult } from "../engine/giac-session";
import { lineNames } from "../engine/dependencies";
import { ANS_VARIABLE, latexToGiac, UnsupportedLatex } from "../engine/latex-to-giac";
import { OPERATOR_NAMES } from "../ui/commands";
import { Graph, type View } from "./graph";
import { unlocalise } from "./plot-items";
import { isTextLine, splitLines } from "./lines";
import { History, typingOf, type Typing } from "./history";
import { editMatrix, matrixAtCaret, matrixLatex, type MatrixAction, type MatrixInfo } from "./matrix";
import { atLineStart, breakLine, caretLine, deleteAtBrackets, fillEmptyMatrixCells, focusImmediately, lineBoxes, moveByWord, type LineBox } from "./mathlive-internals";

/** plot(…): the line's result is a graph, drawn below the cell. */
/** sliders: names without a value (a in a·x²), kept in Giac as prefix + name. */
type PlotLine = {
  ok: true;
  plot: Extract<PlotResult, { ok: true }>;
  sliders?: { prefix: string; names: string[]; values: Record<string, number> };
};

/** What one line of a cell shows on the right: nothing (text or empty line), a result, or "computing". */
type LineResult = EvalResult | PlotLine | "pending" | null;

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
  /** The graphs of plot(…) lines, below the cell, by line index. */
  graphsEl: HTMLElement;
  graphs: Map<number, { result: PlotLine; graph: Graph }>;
  /** Views zoomed or panned to, by line index; saved with the cell. */
  views: Record<number, View>;
  /** Slider values, by line index; saved with the cell. */
  sliders: Record<number, Record<string, number>>;
  /** The text as the undo history last saw it, and the caret in it. */
  recorded: Snapshot;
};

type Snapshot = { latex: string; position: number };

/** One step of the notebook's undo history. */
type Step =
  | { kind: "edit"; entry: Entry; before: Snapshot; after: Snapshot; join: { owner: Entry; typing: Typing; at: number } }
  | { kind: "insert" | "delete"; entry: Entry; index: number }
  | { kind: "answers"; entry: Entry; before: Answers | null; after: Answers | null };

/** A cell's own answer form, overriding the global setting. */
export type Answers = "exact" | "approx";

/** One cell as saved: its input, its own answer form, and its graphs' views (by line). */
export type Cell = {
  latex: string;
  answers?: Answers;
  views?: Record<number, View>;
  sliders?: Record<number, Record<string, number>>;
};

// Shortcuts MathLive applies while typing. Its defaults include surprises for
// a calculator (e.g. "in" becomes ∈), so start from a short allowlist.
const KEPT_SHORTCUTS = [
  "alpha", "delta", "Delta", "pi", "Pi", "theta", "Theta", "infty", "oo",
  "sqrt", "int", "sum", "prod", "lim", "dx", "dy", "dt",
  "sin", "cos", "tan", "arcsin", "arccos", "arctan", "sinh", "cosh", "tanh", "cot", "sec", "csc",
  "ln", "<=", ">=", "!=", ":=", "->",
  "deg", // after a number: 30deg becomes 30°
];
const EXTRA_SHORTCUTS: Record<string, string> = {
  log: "\\log", // MathLive's default asks for a base; log is base 10 here.
  beta: "\\beta", gamma: "\\gamma", lambda: "\\lambda", mu: "\\mu", sigma: "\\sigma",
  omega: "\\omega", phi: "\\phi", epsilon: "\\epsilon", rho: "\\rho", tau: "\\tau",
  // The last case of a piecewise function reads as a word, not a variable.
  otherwise: "\\text{otherwise}",
};

const MATRIX_KEYS: Record<string, MatrixAction> = {
  ArrowUp: "addRowAbove",
  ArrowDown: "addRowBelow",
  ArrowLeft: "addColumnLeft",
  ArrowRight: "addColumnRight",
};

/** unit: typing a unit (Ctrl+U), so letters are upright units, not variables. graph: a graph has the keyboard. */
export type Context = { matrix: MatrixInfo | null; unit: boolean; graph?: boolean; list?: boolean };

/** Minimum space, in px, between the results of one multi-line cell. */
const RESULT_GAP = 8;

// Injected into each math-field's shadow root: text lines (# …) read as
// headings. MathLive renders every text-mode character as span.ML__text.
const FIELD_CSS = `.ML__text { font-weight: 600; letter-spacing: 0.005em; }`;

export class Notebook {
  private entries: Entry[] = [];
  private active: Entry | null = null;
  private shortcuts: Record<string, any> | null = null;
  /** Ctrl+U: letters typed now are a unit (upright), until Space, Ctrl+U or an operator. */
  private unitMode = false;
  /** The global answer mode (settings); Alt+Enter switches a cell to the other form. */
  answerMode: AnswerMode = "auto";
  /** Settings: scroll so the current cell is never below the middle of the window. */
  centreCell = true;
  /** Ctrl+Z / Ctrl+Y: every change to the cells, in order, whichever cell it was in. */
  private history = new History<Step>();
  /** What the key being handled does to the text, for joining undo steps. */
  private typing: Typing = null;
  /** Undo or redo is changing the cells: don't record that as a new step. */
  private restoring = false;
  /**
   * A Ctrl+Z (or Ctrl+Y) that is still held: its key keeps undoing until it
   * is released, even if the repeats arrive without Ctrl (docs/gotchas.md).
   */
  private held: { key: string; action: "undo" | "redo" } | null = null;
  private resizeObserver = new ResizeObserver((records) => {
    for (const r of records) {
      const entry = this.entries.find((e) => e.el === r.target);
      if (entry) this.layoutResults(entry);
      // The current cell grew (a new line, a tall result, a graph): keep it centred.
      if (entry && entry === this.active && entry.mf.hasFocus()) this.centre(entry);
    }
  });

  /** The entries' text changed (for the unsaved marker and autosave). */
  onChange: () => void = () => {};
  /** The caret moved into or out of a matrix. */
  onContext: (ctx: Context) => void = () => {};
  /** A message for the status bar. */
  onMessage: (text: string) => void = () => {};
  /** A cell was evaluated: what graphs show may have changed. */
  onEvaluated: () => void = () => {};

  constructor(private container: HTMLElement, private engine: Engine) {
    // Positions measured before the maths fonts arrive are wrong; redo them.
    document.fonts?.addEventListener("loadingdone", () => this.relayout());
    void document.fonts?.ready.then(() => this.relayout());
    window.addEventListener("keyup", (e) => {
      if (this.held && e.key.toLowerCase() === this.held.key) this.held = null;
    }, { capture: true });
    window.addEventListener("blur", () => (this.held = null));
    engine.onRestart = () => {
      this.recalculation++;
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
    return this.entries.map((e) => {
      const cell: Cell = { latex: e.mf.value };
      if (e.answers) cell.answers = e.answers;
      if (Object.keys(e.views).length) cell.views = e.views;
      if (Object.keys(e.sliders).length) cell.sliders = e.sliders;
      return cell;
    });
  }

  /** Replaces every entry. Always leaves at least one. */
  load(cells: Cell[]) {
    for (const e of this.entries) this.resizeObserver.unobserve(e.el);
    this.container.replaceChildren();
    this.entries = [];
    this.active = null;
    this.history.clear();
    const list = cells.length ? cells : [{ latex: "" }];
    list.forEach((cell, i) => this.createEntry(cell.latex, i, cell.answers ?? null, cell.views, cell.sliders));
  }

  /**
   * Alt+Enter: the cell shows the other form of its answers (decimals, or
   * exact ones when the global setting is "Decimals only"), or goes back to
   * the global setting. Saved with the cell; re-runs it.
   */
  toggleAnswers(entry = this.active ?? this.entries[this.entries.length - 1]) {
    const answers = entry.answers ? null : this.answerMode === "approx" ? "exact" : "approx";
    this.history.push({ kind: "answers", entry, before: entry.answers, after: answers }, () => {});
    this.setAnswers(entry, answers);
  }

  private setAnswers(entry: Entry, answers: Answers | null) {
    entry.answers = answers;
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

  /** The line the caret is on in the entry being edited (LaTeX), or null. */
  currentLine(): string | null {
    const entry = this.active;
    if (!entry) return null;
    return splitLines(entry.mf.value)[caretLine(entry.mf)] ?? null;
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
    this.recalculation++;
    await this.engine.reset();
    for (const entry of [...this.entries]) {
      if (!this.entries.includes(entry)) continue;
      await this.evaluate(entry);
    }
  }

  // ---- entries ------------------------------------------------------------

  private createEntry(
    latex: string,
    index: number,
    answers: Answers | null = null,
    views: Record<number, View> = {},
    sliders: Record<number, Record<string, number>> = {},
  ): Entry {
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
    const graphsEl = document.createElement("div");
    graphsEl.className = "entry-graphs";
    el.append(mf, resultEl, graphsEl, chip);

    const entry: Entry = {
      el, mf, resultEl, evaluatedLatex: null, results: [], answers, chip, graphsEl, graphs: new Map(),
      views: { ...views }, sliders: { ...sliders }, recorded: { latex: "", position: 0 },
    };
    chip.addEventListener("click", () => this.toggleAnswers(entry));
    this.showAnswersChip(entry);
    this.attach(entry, index);
    const style = document.createElement("style");
    style.textContent = FIELD_CSS;
    mf.shadowRoot?.append(style);
    mf.value = latex;
    fillEmptyMatrixCells(mf);
    entry.recorded = { latex: mf.value, position: 0 };

    mf.addEventListener("keydown", (e) => this.onKeyDown(entry, e), { capture: true });
    mf.addEventListener("move-out", (e) => this.onMoveOut(entry, e as CustomEvent));
    mf.addEventListener("blur", () => {
      if (!this.unitMode) return;
      this.unitMode = false;
      mf.inlineShortcuts = this.shortcuts!;
    });
    mf.addEventListener("focus", () => {
      // A click into a cell low on the screen brings it up to the middle too.
      if (this.active !== entry) this.centreSoon(entry);
      this.active = entry;
      this.emitContext(entry);
    });
    mf.addEventListener("selection-change", () => {
      // Where an undo of the next change puts the caret back.
      if (mf.value === entry.recorded.latex) entry.recorded.position = mf.position;
      this.emitContext(entry);
    });
    // A click moves the caret: what is typed next is a new undo step.
    mf.addEventListener("pointerdown", () => {
      this.history.seal();
      this.held = null;
    });
    // Text that arrives while Ctrl+Z is held (a repeat without Ctrl, or an
    // input method's commit) is not typed; MathLive listens further in.
    for (const type of ["beforeinput", "input"]) {
      mf.addEventListener(type, (e) => {
        if (!this.held) return;
        e.preventDefault();
        e.stopPropagation();
      }, { capture: true });
    }
    mf.addEventListener("input", () => {
      // Deleting a matrix cell's content (or its box) leaves it empty; refill it.
      fillEmptyMatrixCells(mf);
      this.record(entry);
      el.classList.toggle("stale", entry.evaluatedLatex !== null && mf.value !== entry.evaluatedLatex);
      // Lines move as you type; keep results and leader dots beside them.
      requestAnimationFrame(() => this.layoutResults(entry));
      this.onChange();
    });
    return entry;
  }

  /** Shortcuts and keybindings for a math field (the cells, and the graph panel's rows). */
  configure(mf: MathfieldElement) {
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

  /** Puts an entry's element in the notebook at `index` (a new one, or one brought back by undo). */
  private attach(entry: Entry, index: number) {
    const next = this.entries[index];
    this.container.insertBefore(entry.el, next ? next.el : null);
    this.entries.splice(index, 0, entry);
    // MathLive rejects option access until the field is in the document, and
    // rebuilds the field from its attributes alone when it is put back.
    this.configure(entry.mf);
    this.resizeObserver.observe(entry.el);
  }

  private detach(entry: Entry) {
    this.resizeObserver.unobserve(entry.el);
    entry.el.remove();
    this.entries.splice(this.entries.indexOf(entry), 1);
    if (this.active === entry) this.active = null;
  }

  private removeEntry(entry: Entry) {
    const index = this.entries.indexOf(entry);
    if (index < 0 || this.entries.length === 1) return;
    const defined = entry.evaluatedLatex === null ? [] : [...cellNames(entry.evaluatedLatex).assigns];
    if (!this.restoring) this.history.push({ kind: "delete", entry, index }, () => {});
    this.detach(entry);
    this.focus(this.entries[Math.max(0, index - 1)], index > 0 ? "end" : "start");
    this.onChange();
    // Its definitions go with it: the cells that used them recalculate.
    if (defined.length) void this.recalculateFrom(index, new Set(defined), defined, false);
  }

  private insertEntryAfter(entry: Entry): Entry {
    const index = this.entries.indexOf(entry) + 1;
    const created = this.createEntry("", index);
    this.history.push({ kind: "insert", entry: created, index }, () => {});
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
    this.keepInView(entry);
  }

  /** Brings a cell into view; with centring, one below the middle goes to the middle. */
  private keepInView(entry: Entry) {
    const scroller = this.container.closest(".notebook");
    const above = scroller instanceof HTMLElement && entry.el.getBoundingClientRect().top < scroller.getBoundingClientRect().top;
    // An instant scrollIntoView would cut a smooth centring short; centre() also handles cells below the window.
    if (!this.centreCell || above) entry.el.scrollIntoView({ block: "nearest" });
    this.centreSoon(entry);
  }

  /** The room to scroll appeared (main.ts): centre the current cell again. */
  recentre() {
    if (this.active) this.centre(this.active);
  }

  /**
   * With the "centred" setting: when the current cell's middle is below the
   * middle of the window, scroll it to the middle (above the middle, leave
   * it). A cell taller than the window goes to the top instead, so as much
   * of it as possible shows, unless that would hide the caret's line, which
   * is then centred.
   */
  private centre(entry: Entry) {
    if (!this.centreCell) return;
    const scroller = this.container.closest(".notebook");
    if (!(scroller instanceof HTMLElement)) return;
    const view = scroller.getBoundingClientRect();
    const cell = entry.el.getBoundingClientRect();
    let by = (cell.top + cell.bottom) / 2 - (view.top + view.height / 2);
    if (cell.height > view.height - 24) {
      const line = lineBoxes(entry.mf)[caretLine(entry.mf)];
      by = cell.top - view.top - 12;
      const lineAfter = line ? line.bottom - by : 0;
      if (line && line.bottom > line.top && lineAfter > view.bottom - 24) by = (line.top + line.bottom) / 2 - (view.top + view.height / 2);
    }
    if (by <= 1) return;
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    scroller.scrollBy({ top: by, behavior: reduce ? "auto" : "smooth" });
  }

  /**
   * Centring after moving to a cell waits for MathLive, which scrolls its
   * caret into view when the field takes focus; that instant scroll would
   * cut a smooth centring short.
   */
  private centreSoon(entry: Entry) {
    clearTimeout(this.centreTimer);
    this.centreTimer = window.setTimeout(() => {
      if (this.active === entry) this.centre(entry);
    }, 90);
  }
  private centreTimer: number | undefined;

  // ---- keys ---------------------------------------------------------------

  // Registered in the capture phase on the math-field host, so it runs before
  // MathLive's own handler inside the shadow DOM and can claim a key outright.
  private onKeyDown(entry: Entry, e: KeyboardEvent) {
    const claim = () => {
      e.preventDefault();
      e.stopPropagation();
    };
    const mod = e.ctrlKey || e.metaKey;

    // A change that fired no "input" (a matrix box refilled) is a step of its own.
    this.record(entry);
    const key = e.key.toLowerCase();
    if (this.held && !e.altKey && (key === this.held.key || key === "process" || key === "unidentified")) {
      claim();
      this[this.held.action]();
      return;
    }
    if (mod && !e.altKey && (key === "z" || key === "y")) {
      claim();
      this.held = { key, action: key === "y" || e.shiftKey ? "redo" : "undo" };
      this[this.held.action]();
      return;
    }
    this.typing = typingOf(e);
    if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End", "Tab"].includes(e.key)) this.history.seal();
    requestAnimationFrame(() => {
      this.record(entry);
      this.typing = null;
    });

    if (key === "u" && mod && !e.altKey && !e.shiftKey) {
      claim();
      this.setUnitMode(entry, !this.unitMode);
      return;
    }
    if (this.unitMode && this.unitKey(entry, e)) {
      claim();
      return;
    }

    // Typing \ opens MathLive's LaTeX mode and its list of suggestions
    // (\alp → \alpha): there Enter and Tab accept one and ↑/↓ choose. Leave
    // those keys to MathLive, or Enter would evaluate the half-typed command.
    if (entry.mf.mode === "latex" && !mod && !e.altKey && ["Enter", "Tab", "ArrowUp", "ArrowDown"].includes(e.key)) return;

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

    if (e.altKey && !mod && !e.shiftKey && e.key === "ArrowDown" && !matrixAtCaret(entry.mf) && this.focusGraph(entry)) {
      claim();
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
    if (e.key === "Backspace" || e.key === "Delete") {
      requestAnimationFrame(() => {
        fillEmptyMatrixCells(entry.mf);
        this.record(entry, true);
      });
    }

    if ((e.key === "Backspace" || e.key === "Delete") && !e.shiftKey && !e.altKey && deleteAtBrackets(entry.mf, e.key, mod)) {
      claim();
      return;
    }

    if (e.key === "Backspace" && mod && e.shiftKey) {
      claim();
      this.removeEntry(entry);
      return;
    }
    if (e.key === "Backspace" && !e.altKey && entry.mf.value === "" && this.entries.length > 1) {
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
    this.onContext({ matrix: matrixAtCaret(entry.mf), unit: this.unitMode });
  }

  /** Ctrl+P "Type a unit": unit mode in the entry being edited. */
  startUnit() {
    const entry = this.active ?? this.entries[this.entries.length - 1];
    focusImmediately(entry.mf);
    this.setUnitMode(entry, true);
  }

  // Unit mode is MathLive's upright style for what is typed next, which
  // serialises as \mathrm{km}; the converter reads upright letters as units.
  private setUnitMode(entry: Entry, on: boolean) {
    if (on === this.unitMode) return;
    this.unitMode = on;
    entry.mf.applyStyle({ variantStyle: on ? "up" : "" });
    // Typing shortcuts would turn units into symbols (deg is °, min a command).
    entry.mf.inlineShortcuts = on ? {} : this.shortcuts!;
    this.emitContext(entry);
  }

  /**
   * A key in unit mode. Letters, digits, ° (°C) and ^ (m²) are part of the unit; /
   * stays inline (km/h, not a fraction); * is a · between units (MathLive
   * would serialise a \cdot inside the upright group as plain letters).
   * Space or Esc leaves unit mode; any other key leaves it and does its
   * usual thing. Returns true when the key was handled here.
   */
  private unitKey(entry: Entry, e: KeyboardEvent): boolean {
    if (e.ctrlKey || e.metaKey || e.altKey || ["Shift", "Backspace", "Delete", "CapsLock"].includes(e.key)) return false;
    if (/^[A-Za-z0-9^]$/.test(e.key)) return false;
    if (e.key === "°") {
      entry.mf.insert("°"); // °C, °F: part of the unit, not the angle sign
      return true;
    }
    if (e.key === "/") {
      entry.mf.insert("/");
      return true;
    }
    if (e.key === "*") {
      this.setUnitMode(entry, false);
      entry.mf.insert("\\cdot");
      this.setUnitMode(entry, true);
      return true;
    }
    this.setUnitMode(entry, false);
    return e.key === " " || e.key === "Escape";
  }

  // ---- undo -----------------------------------------------------------------

  /**
   * Records a change to the entry's text as an undo step, joined to the step
   * before while typing a word or deleting (history.ts). `fixup`: a box put
   * back in an emptied matrix cell belongs to the step that emptied it.
   */
  private record(entry: Entry, fixup = false) {
    if (this.restoring) return;
    const latex = entry.mf.value;
    if (latex === entry.recorded.latex) return;
    const after = { latex, position: entry.mf.position };
    const last = this.history.last;
    if (fixup && last?.kind === "edit" && last.entry === entry) {
      last.after = after;
    } else {
      const step: Step = { kind: "edit", entry, before: entry.recorded, after, join: { owner: entry, typing: this.typing, at: Date.now() } };
      this.history.push(step, (into, joined) => {
        if (into.kind === "edit" && joined.kind === "edit") into.after = joined.after;
      });
    }
    entry.recorded = { ...after };
  }

  /** Ctrl+Z: takes back the last change, in whichever cell it was. */
  undo() {
    if (this.active) this.record(this.active);
    const step = this.history.undo();
    if (step) this.apply(step, "undo");
    else this.onMessage("Nothing to undo.");
  }

  /** Ctrl+Y or Ctrl+Shift+Z: puts back what undo took. */
  redo() {
    if (this.active) this.record(this.active);
    const step = this.history.redo();
    if (step) this.apply(step, "redo");
    else this.onMessage("Nothing to redo.");
  }

  private apply(step: Step, direction: "undo" | "redo") {
    const back = direction === "undo";
    this.restoring = true;
    try {
      if (step.kind === "edit") this.setText(step.entry, back ? step.before : step.after);
      else if (step.kind === "answers") this.setAnswers(step.entry, back ? step.before : step.after);
      else if ((step.kind === "insert") === back) this.removeEntry(step.entry);
      else if (step.kind === "insert") {
        this.attach(step.entry, Math.min(step.index, this.entries.length));
        this.focus(step.entry, "end");
        this.onChange();
      } else void this.restore(step.entry, step.index);
    } finally {
      this.restoring = false;
    }
  }

  private setText(entry: Entry, to: Snapshot) {
    entry.mf.value = to.latex;
    fillEmptyMatrixCells(entry.mf);
    entry.recorded = { latex: entry.mf.value, position: to.position };
    entry.el.classList.toggle("stale", entry.evaluatedLatex !== null && entry.mf.value !== entry.evaluatedLatex);
    requestAnimationFrame(() => this.layoutResults(entry));
    this.onChange();
    this.active = entry;
    ensureFocused(entry.mf, () => {
      focusImmediately(entry.mf);
      entry.mf.position = to.position;
    });
    this.keepInView(entry);
    this.emitContext(entry);
  }

  /**
   * Undoing a delete: the cell comes back as it was, results included. What
   * it defined applies again, so it runs again, and so do the cells below
   * that use it (the reverse of removeEntry).
   */
  private async restore(entry: Entry, index: number) {
    this.attach(entry, Math.min(index, this.entries.length));
    this.focus(entry, "end");
    this.onChange();
    if (entry.evaluatedLatex === null) return;
    const names = cellNames(entry.evaluatedLatex);
    if (!names.assigns.size && !names.stateful) return;
    await this.rerun(entry);
    if (!this.entries.includes(entry)) return;
    await this.recalculateFrom(this.entries.indexOf(entry) + 1, new Set(names.assigns), [], names.stateful);
  }

  // ---- evaluation ---------------------------------------------------------

  private async evaluateAndAdvance(entry: Entry) {
    const index = this.entries.indexOf(entry);
    const next = this.entries[index + 1];
    // Like a calculator: Enter on the last entry opens a fresh one.
    if (next) this.focus(next, "end");
    else if (entry.mf.value.trim()) this.insertEntryAfter(entry);
    const before = entry.evaluatedLatex === null ? new Set<string>() : cellNames(entry.evaluatedLatex).assigns;
    await this.evaluate(entry);
    // Results arrive after the caret moved on; a tall one (a graph) can push
    // the caret's cell out of view. Bring it back: the graph is right above it.
    if (this.active && this.active !== entry) this.keepInView(this.active);
    if (!this.entries.includes(entry) || entry.evaluatedLatex === null) return;
    const now = cellNames(entry.evaluatedLatex);
    const dropped = [...before].filter((name) => !now.assigns.has(name));
    if (now.assigns.size || dropped.length || now.stateful) {
      await this.recalculateFrom(this.entries.indexOf(entry) + 1, new Set([...now.assigns, ...dropped]), dropped, now.stateful);
    }
  }

  // ---- recalculation --------------------------------------------------------

  /** Counts recalculations; a newer one (or Run all, or a cancel) stops an older one. */
  private recalculation = 0;

  /**
   * After a definition changed, re-runs the cells from `start` on that use
   * a changed name, top to bottom, and then the cells that use what those
   * define (decision 0007). `dropped` names are no longer defined by that
   * cell: the nearest cell above that defines them runs again, or they are
   * cleared. `everything` (after restart, purge, assume) re-runs every cell.
   */
  private async recalculateFrom(start: number, changed: Set<string>, dropped: string[], everything: boolean) {
    const run = ++this.recalculation;
    const live = () => run === this.recalculation;
    for (const name of dropped) {
      const above = this.entries.slice(0, start).reverse().find((e) => e.evaluatedLatex !== null && cellNames(e.mf.value).assigns.has(name));
      if (above) await this.rerun(above);
      else await this.engine.evaluate(`purge(${name})`);
      if (!live()) return;
    }
    let previousRan = true;
    for (const entry of this.entries.slice(start)) {
      if (!live()) return;
      if (!this.entries.includes(entry) || entry.evaluatedLatex === null) {
        previousRan = false;
        continue;
      }
      const names = cellNames(entry.mf.value);
      const uses = [...names.reads].some((n) => changed.has(n)) || (previousRan && names.reads.has(ANS_VARIABLE));
      // A cell that defines a changed name itself runs again to put its own value back.
      const redefines = [...names.assigns].some((n) => changed.has(n));
      if (!everything && !uses && !redefines && !names.stateful) {
        previousRan = false;
        continue;
      }
      await this.rerun(entry);
      if (!live()) return;
      for (const n of names.assigns) {
        if (everything || uses) changed.add(n);
        else changed.delete(n);
      }
      previousRan = true;
    }
  }

  /** Evaluates a cell again; results that changed flash briefly. */
  private async rerun(entry: Entry) {
    const before = resultsKey(entry);
    await this.evaluate(entry);
    if (resultsKey(entry) === before || !this.entries.includes(entry)) return;
    entry.el.classList.remove("recalculated");
    void entry.el.offsetWidth; // restart the animation
    entry.el.classList.add("recalculated");
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
      let result: EvalResult | PlotLine;
      try {
        const giac = latexToGiac(lines[i]);
        if (/^plot\W?\(/.test(giac)) {
          result = await this.plotLine(entry, i, giac);
        } else {
          result = await this.engine.evaluate(giac, entry.answers ?? undefined);
        }
      } catch (err) {
        if (!(err instanceof UnsupportedLatex)) throw err;
        result = { ok: false, error: err.message };
      }
      if (!this.entries.includes(entry) || entry.evaluatedLatex !== latex) return;
      entry.results[i] = result;
      this.renderResults(entry);
    }
    entry.el.classList.toggle("stale", entry.mf.value !== latex);
    this.onEvaluated();
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
      if ("plot" in result) {
        const note = document.createElement("span");
        note.className = "graph-note";
        note.textContent = "graph below · Alt+↓";
        row.append(note);
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
    this.renderGraphs(entry);
    this.layoutResults(entry);
  }

  /** Keeps one graph per plot(…) line, below the cell; a graph is rebuilt only when its result is new. */
  private renderGraphs(entry: Entry) {
    const wanted = new Map<number, PlotLine>();
    entry.results.forEach((r, i) => {
      if (r && r !== "pending" && r.ok && "plot" in r) wanted.set(i, r);
    });
    for (const [i, { result, graph }] of entry.graphs) {
      if (wanted.get(i) !== result) {
        graph.destroy();
        entry.graphs.delete(i);
      }
    }
    for (const [i, result] of wanted) {
      if (entry.graphs.has(i)) continue;
      const graph = new Graph({
        // A value draws nothing, except f(a), which marks its point.
        items: result.plot.items.flatMap((item) =>
          item.kind !== "value" ? [item] : item.point ? [{ kind: "points" as const, label: item.label, points: [item.point] }] : [],
        ),
        xRange: result.plot.xRange,
        view: entry.views[i] ?? null,
        sample: (fn, a, b, n) => this.engine.sample(fn, a, b, n),
        features: (fn, others, a, b) => this.engine.features(fn, others, a, b),
        onView: (view) => {
          if (view) entry.views[i] = view;
          else delete entry.views[i];
          this.onChange();
        },
        onExit: () => focusImmediately(entry.mf),
        sliders: result.sliders && {
          names: result.sliders.names,
          values: result.sliders.values,
          onChange: async (name, value) => {
            const { prefix, values } = result.sliders!;
            values[name] = value;
            entry.sliders[i] = { ...values };
            await this.engine.run(`${prefix}${name}:=${value}`);
            this.onChange();
          },
        },
      });
      graph.el.addEventListener("focus", () => {
        this.active = entry;
        this.onContext({ matrix: null, unit: false, graph: true });
      });
      entry.graphs.set(i, { result, graph });
    }
    const els = [...entry.graphs.entries()].sort((a, b) => a[0] - b[0]).map(([, g]) => g.graph.el);
    if (els.length !== entry.graphsEl.children.length || els.some((el, k) => entry.graphsEl.children[k] !== el)) entry.graphsEl.replaceChildren(...els);
  }

  private sliderIds = 0;

  /**
   * plot(…) for one line. Names without a value become sliders: they keep a
   * name of this graph's own (prefix + name) so they don't clash with other
   * graphs or the notebook, stay symbols in the curves, and get their value
   * (1, or the saved one) before the graph samples them.
   */
  private async plotLine(entry: Entry, line: number, typed: string): Promise<EvalResult | PlotLine> {
    // ax is a·x here (graphs only), before slider names get their own form.
    const giac = await this.engine.splitUnknown(typed);
    const plain = await this.engine.plot(giac);
    if (plain.ok) return { ok: true, plot: plain };
    if (!plain.missing?.length) return plain;
    const names = plain.missing;
    const prefix = `maddox_s${++this.sliderIds}_`;
    const saved = entry.sliders[line] ?? {};
    const values = Object.fromEntries(names.map((n) => [n, Number.isFinite(saved[n]) ? saved[n] : 1]));
    const plot = await this.engine.plot(giac, Object.fromEntries(names.map((n) => [n, prefix + n])));
    if (!plot.ok) return { ok: false, error: unlocalise(plot.error) };
    for (const n of names) await this.engine.run(`${prefix}${n}:=${values[n]}`);
    const items = plot.items.map((item) => ({ ...item, label: unlocalise(item.label) }));
    return { ok: true, plot: { ...plot, items }, sliders: { prefix, names, values } };
  }

  /** Alt+↓ on a cell with a graph: the keyboard goes into the (first) graph. */
  private focusGraph(entry: Entry): boolean {
    const first = [...entry.graphs.entries()].sort((a, b) => a[0] - b[0])[0];
    if (!first) return false;
    first[1].graph.focus();
    return true;
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

/** What a cell's maths lines assign and use, all lines together. */
function cellNames(latex: string): { assigns: Set<string>; reads: Set<string>; stateful: boolean } {
  const names = { assigns: new Set<string>(), reads: new Set<string>(), stateful: false };
  for (const line of splitLines(latex)) {
    if (!line || isTextLine(line)) continue;
    let giac: string;
    try {
      giac = latexToGiac(line);
    } catch {
      continue; // shows its own error, defines nothing
    }
    const found = lineNames(giac);
    found.assigns.forEach((n) => names.assigns.add(n));
    found.reads.forEach((n) => names.reads.add(n));
    names.stateful ||= found.stateful;
  }
  return names;
}

/** The results as text, to tell whether a re-run changed anything. */
function resultsKey(entry: Entry): string {
  return JSON.stringify(entry.results);
}
