// The graph panel (Ctrl+G): a coordinate system beside the notebook, with
// tabs. Each tab has its own list of what it shows (one maths field per row:
// f, D, x² − 2) and its own view. Saved in the .maddox file.
import { MathfieldElement, convertLatexToMarkup } from "mathlive";
import type { Engine } from "../engine/engine";
import type { DrawnItem } from "../engine/giac-session";
import { latexToGiac, UnsupportedLatex } from "../engine/latex-to-giac";
import { Graph, type View } from "../notebook/graph";
import { focusImmediately } from "../notebook/mathlive-internals";
import { LOCAL, localise, readPanelRow, type PanelRow } from "../notebook/plot-items";

export type PanelTab = { name: string; items: string[]; view?: View };
export type PanelState = { open: boolean; active: number; tabs: PanelTab[] };

const newTab = (n: number): PanelTab => ({ name: `Graph ${n}`, items: [""] });

/** A saved panel, checked; anything malformed falls back to one empty tab. */
export function readPanel(data: unknown): PanelState {
  const d = data as any;
  const tabs: PanelTab[] = Array.isArray(d?.tabs)
    ? d.tabs
        .filter((t: any) => typeof t?.name === "string" && Array.isArray(t.items))
        .map((t: any) => {
          const tab: PanelTab = { name: t.name, items: t.items.filter((i: unknown) => typeof i === "string") };
          if (!tab.items.length) tab.items = [""];
          const v = t.view;
          if (v && ["xmin", "xmax", "ymin", "ymax"].every((k) => Number.isFinite(v[k])) && v.xmin < v.xmax && v.ymin < v.ymax) tab.view = v;
          return tab;
        })
    : [];
  if (!tabs.length) tabs.push(newTab(1));
  const active = Number.isInteger(d?.active) && d.active >= 0 && d.active < tabs.length ? d.active : 0;
  return { open: d?.open === true, active, tabs };
}

export class GraphPanel {
  private state: PanelState = readPanel(null);
  private tabsEl: HTMLElement;
  private listEl: HTMLElement;
  private graphEl: HTMLElement;
  private rows: { mf: MathfieldElement; error: HTMLElement; value: HTMLElement }[] = [];
  private graph: Graph | null = null;
  private plotTimer: number | undefined;
  private generation = 0;
  private closing: number | null = null;
  /** The names the plotted tab defined in Giac (g in g(x) = …), cleared before the next plot. */
  private locals: string[] = [];

  /** The panel's content changed (unsaved marker, autosave). */
  onChange: () => void = () => {};
  /** Esc or Ctrl+G: the keyboard goes back to the notebook. */
  onExit: () => void = () => {};
  /** Hints: the list (false) or the graph (true) has the keyboard. */
  onContext: (graph: boolean) => void = () => {};

  constructor(
    private el: HTMLElement,
    private engine: Engine,
    private configureField: (mf: MathfieldElement) => void,
  ) {
    this.tabsEl = document.createElement("div");
    this.tabsEl.className = "panel-tabs";
    this.tabsEl.setAttribute("role", "tablist");
    this.listEl = document.createElement("div");
    this.listEl.className = "panel-list";
    this.graphEl = document.createElement("div");
    this.graphEl.className = "panel-graph";
    el.append(this.tabsEl, this.listEl, this.graphEl);
    el.addEventListener("keydown", (e) => this.onPanelKey(e), { capture: true });
  }

  get isOpen() {
    return this.state.open;
  }

  /** What the file keeps: tabs, their lists (without empty rows) and views, open or not. */
  get saved(): PanelState {
    return {
      open: this.state.open,
      active: this.state.active,
      tabs: this.state.tabs.map((t) => {
        const tab: PanelTab = { name: t.name, items: t.items.filter((i) => i.trim()) };
        if (t.view) tab.view = t.view;
        return tab;
      }),
    };
  }

  get hasFocus() {
    return this.el.contains(document.activeElement);
  }

  private get tab(): PanelTab {
    return this.state.tabs[this.state.active];
  }

  load(state: unknown) {
    this.state = readPanel(state);
    this.apply();
    if (this.state.open) this.build();
  }

  toggle() {
    if (this.state.open) this.close();
    else this.open();
  }

  /** Opens the panel; with focus, the keyboard goes to the tab's last row. */
  open(focus = true) {
    if (!this.state.open) {
      this.state.open = true;
      this.apply();
      this.build();
      this.onChange();
    }
    if (focus) this.focusRow(this.rows.length - 1);
  }

  close() {
    this.state.open = false;
    this.apply();
    this.graph?.destroy();
    this.graph = null;
    this.onChange();
    this.onExit();
  }

  /** F6: into the panel (its last row). */
  focus() {
    this.focusRow(this.rows.length - 1);
  }

  /** Ctrl+Shift+G: adds items (LaTeX) to the open tab, opening the panel if needed. */
  addItems(items: string[]) {
    const tab = this.tab;
    tab.items = [...tab.items.filter((i) => i.trim()), ...items];
    this.open(false);
    this.build();
    this.onChange();
  }

  /** Re-plots the open tab soon (after a cell was evaluated, or a row edited). */
  refresh(delay = 150) {
    if (!this.state.open) return;
    clearTimeout(this.plotTimer);
    this.plotTimer = window.setTimeout(() => void this.plotTab(), delay);
  }

  private apply() {
    this.el.hidden = !this.state.open;
    document.body.classList.toggle("with-graph-panel", this.state.open);
  }

  // ---- tabs ---------------------------------------------------------------

  private build() {
    this.renderTabs();
    this.renderRows();
    this.refresh(0);
  }

  private renderTabs() {
    this.tabsEl.replaceChildren();
    this.state.tabs.forEach((tab, i) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "panel-tab";
      button.setAttribute("role", "tab");
      button.setAttribute("aria-selected", String(i === this.state.active));
      button.tabIndex = -1;
      const name = document.createElement("span");
      name.textContent = tab.name;
      button.append(name);
      button.addEventListener("mousedown", (e) => e.preventDefault());
      button.addEventListener("click", () => this.select(i));
      button.addEventListener("dblclick", () => this.rename(i));
      if (this.state.tabs.length > 1) {
        const close = document.createElement("span");
        close.className = "panel-tab-close";
        close.textContent = this.closing === i ? "Close?" : "×";
        close.title = "Close this tab";
        close.addEventListener("click", (e) => {
          e.stopPropagation();
          this.closeTab(i);
        });
        button.append(close);
      }
      this.tabsEl.append(button);
    });
    const add = document.createElement("button");
    add.type = "button";
    add.className = "panel-tab-add";
    add.textContent = "+";
    add.title = "New graph tab";
    add.tabIndex = -1;
    add.addEventListener("mousedown", (e) => e.preventDefault());
    add.addEventListener("click", () => this.addTab());
    this.tabsEl.append(add);
  }

  private select(i: number) {
    if (i === this.state.active) return;
    this.state.active = i;
    this.closing = null;
    this.build();
    this.focusRow(this.rows.length - 1);
    this.onChange();
  }

  private addTab() {
    const names = new Set(this.state.tabs.map((t) => t.name));
    let n = this.state.tabs.length + 1;
    while (names.has(`Graph ${n}`)) n++;
    this.state.tabs.push(newTab(n));
    this.select(this.state.tabs.length - 1);
  }

  /** × closes an empty tab at once; a tab with items asks first ("Close?", click again). */
  private closeTab(i: number) {
    const empty = !this.state.tabs[i].items.some((x) => x.trim());
    if (!empty && this.closing !== i) {
      this.closing = i;
      this.renderTabs();
      return;
    }
    this.closing = null;
    this.state.tabs.splice(i, 1);
    if (this.state.active >= i && this.state.active > 0) this.state.active--;
    this.build();
    this.focusRow(this.rows.length - 1);
    this.onChange();
  }

  /** F2 or double-click: the tab's name becomes editable; Enter keeps it, Esc doesn't. */
  private rename(i: number) {
    const button = this.tabsEl.children[i] as HTMLElement | undefined;
    if (!button) return;
    const input = document.createElement("input");
    input.className = "panel-tab-name";
    input.value = this.state.tabs[i].name;
    input.setAttribute("aria-label", "Tab name");
    button.replaceWith(input);
    input.focus();
    input.select();
    let done = false;
    const finish = (keep: boolean) => {
      if (done) return;
      done = true;
      const name = input.value.trim();
      if (keep && name) {
        this.state.tabs[i].name = name;
        this.onChange();
      }
      this.renderTabs();
      this.focusRow(this.rows.length - 1);
    };
    input.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Enter") finish(true);
      if (e.key === "Escape") finish(false);
    });
    input.addEventListener("blur", () => finish(true));
  }

  // ---- the list -------------------------------------------------------------

  private renderRows() {
    this.listEl.replaceChildren();
    this.rows = [];
    this.tab.items.forEach((latex, i) => this.addRow(latex, i));
  }

  private addRow(latex: string, index: number) {
    const row = document.createElement("div");
    row.className = "panel-row";
    const chip = document.createElement("span");
    chip.className = "panel-chip";
    const mf = new MathfieldElement();
    mf.className = "panel-input";
    mf.setAttribute("aria-label", "Something to plot: a function, points, or an expression in x");
    const error = document.createElement("span");
    error.className = "panel-error";
    // A row with no x in it (f(5)) shows its answer here instead of being drawn.
    const leader = document.createElement("span");
    leader.className = "panel-leader";
    leader.setAttribute("aria-hidden", "true");
    const value = document.createElement("span");
    value.className = "panel-value";
    row.append(chip, mf, leader, value, error);
    this.listEl.insertBefore(row, this.listEl.children[index] ?? null);
    this.rows.splice(index, 0, { mf, error, value });
    this.configureField(mf);
    mf.value = latex;
    mf.placeholder = "f, D or x^2";
    this.colourChips();

    mf.addEventListener("keydown", (e) => this.onRowKey(mf, e), { capture: true });
    mf.addEventListener("move-out", (e) => {
      const direction = (e as CustomEvent<{ direction: string }>).detail.direction;
      const i = this.rows.findIndex((r) => r.mf === mf);
      if (direction === "upward" && i > 0) this.focusRow(i - 1);
      if (direction === "downward") {
        if (i < this.rows.length - 1) this.focusRow(i + 1);
        else this.graph?.focus();
      }
    });
    mf.addEventListener("focus", () => this.onContext(false));
    mf.addEventListener("input", () => {
      const i = this.rows.findIndex((r) => r.mf === mf);
      this.tab.items[i] = mf.value;
      this.onChange();
      this.refresh(400);
    });
  }

  private colourChips() {
    this.rows.forEach((r, i) => {
      const chip = r.mf.previousElementSibling as HTMLElement;
      chip.style.setProperty("--colour", `var(--plot-${(i % 6) + 1})`);
    });
  }

  private focusRow(i: number) {
    const row = this.rows[Math.max(0, Math.min(i, this.rows.length - 1))];
    if (!row) return;
    focusImmediately(row.mf);
    row.mf.executeCommand("moveToMathfieldEnd");
  }

  private onRowKey(mf: MathfieldElement, e: KeyboardEvent) {
    const claim = () => {
      e.preventDefault();
      e.stopPropagation();
    };
    const i = this.rows.findIndex((r) => r.mf === mf);
    const mod = e.ctrlKey || e.metaKey;
    if (e.key === "Enter" && !mod && !e.altKey) {
      claim();
      this.tab.items.splice(i + 1, 0, "");
      this.addRow("", i + 1);
      this.focusRow(i + 1);
      this.refresh(0);
      this.onChange();
    } else if (e.key === "Backspace" && !mod && mf.value === "" && this.rows.length > 1) {
      claim();
      this.tab.items.splice(i, 1);
      this.rows[i].mf.parentElement!.remove();
      this.rows.splice(i, 1);
      this.colourChips();
      this.focusRow(i - 1);
      this.refresh(0);
      this.onChange();
    } else if (e.key === "Escape") {
      claim();
      this.onExit();
    }
  }

  // ---- keys for the whole panel ---------------------------------------------

  // Like cells: Ctrl+Enter is a new tab, Ctrl+Shift+Backspace closes one
  // (browsers keep Ctrl+T and Ctrl+W for themselves).
  private onPanelKey(e: KeyboardEvent) {
    const mod = e.ctrlKey || e.metaKey;
    if (mod && !e.shiftKey && e.key === "Enter") {
      e.preventDefault();
      e.stopPropagation();
      this.addTab();
    } else if (mod && e.shiftKey && e.key === "Backspace") {
      e.preventDefault();
      e.stopPropagation();
      if (this.state.tabs.length > 1) this.closeTab(this.state.active);
    } else if (mod && (e.key === "PageUp" || e.key === "PageDown")) {
      e.preventDefault();
      e.stopPropagation();
      const n = this.state.tabs.length;
      this.select((this.state.active + (e.key === "PageDown" ? 1 : -1) + n) % n);
    } else if (e.key === "F2" && !(e.target instanceof HTMLInputElement)) {
      e.preventDefault();
      e.stopPropagation();
      this.rename(this.state.active);
    }
  }

  // ---- the graph --------------------------------------------------------------

  /** Plots every row of the open tab; a row that fails shows why, the others still draw. */
  private async plotTab() {
    const generation = ++this.generation;
    const tab = this.tab;
    const items: DrawnItem[] = [];
    const colours: number[] = [];
    let xRange: [number, number] = [-10, 10];
    // Read every row, then define the tab's own names (g(x) = …, a = …) under
    // their LOCAL names, so any row can use them and the notebook never sees them.
    const read: (PanelRow | null)[] = tab.items.map((item) => {
      if (!item.trim()) return null;
      try {
        return readPanelRow(latexToGiac(item));
      } catch (err) {
        if (!(err instanceof UnsupportedLatex)) throw err;
        return { kind: "error", error: err.message };
      }
    });
    const names = new Set<string>();
    const errors: string[] = read.map((row) => {
      if (row?.kind === "error") return row.error;
      if (row?.kind !== "function" && row?.kind !== "value") return "";
      if (names.has(row.name)) return `${row.name} is already defined in this graph`;
      names.add(row.name);
      return "";
    });
    if (this.locals.length) await this.engine.run(`purge(${this.locals.join(",")})`);
    this.locals = [...names].map((n) => LOCAL + n);
    for (let i = 0; i < read.length; i++) {
      const row = read[i];
      if (errors[i] || (row?.kind !== "function" && row?.kind !== "value")) continue;
      const head = row.kind === "function" ? `${LOCAL}${row.name}(${row.param})` : LOCAL + row.name;
      const defined = await this.engine.run(`${head}:=${localise(row.body, names)}`);
      if (!defined.ok) errors[i] = defined.error;
    }
    for (let i = 0; i < tab.items.length; i++) {
      const latex = tab.items[i]?.trim() ?? "";
      const row = this.rows[i];
      const parsed = read[i];
      let error = errors[i] ?? "";
      let value: { latex: string; approxLatex: string | null; point?: [number, number] } | null = null;
      if (parsed && !error) {
        try {
          const what = parsed.kind === "function" || parsed.kind === "value" ? LOCAL + parsed.name : parsed.kind === "expression" ? localise(parsed.body, names) : "";
          const result = await this.engine.plot(`plot(${what})`);
          if (result.ok) {
            for (const item of result.items) {
              if (item.kind === "value") {
                value = item;
                if (!item.point) continue;
                // f(0): also a dot at (0, f(0)), in the row's colour.
                items.push({ kind: "points", label: latex, points: [item.point] });
                colours.push(i);
                continue;
              }
              items.push(item);
              colours.push(i);
            }
            if (result.xRange[1] > xRange[1]) xRange = result.xRange;
          } else error = result.error.replaceAll(LOCAL, "");
        } catch (err) {
          if (!(err instanceof UnsupportedLatex)) throw err;
          error = err.message;
        }
      }
      if (generation !== this.generation) return;
      if (row) {
        row.error.textContent = error;
        row.mf.parentElement!.classList.toggle("has-error", Boolean(error));
        row.mf.parentElement!.classList.toggle("has-value", value !== null);
        row.mf.parentElement!.classList.toggle("has-point", Boolean(value?.point));
        row.value.innerHTML = value
          ? `= ${convertLatexToMarkup(value.latex)}${value.approxLatex ? ` <span class="approx">≈ ${convertLatexToMarkup(value.approxLatex)}</span>` : ""}`
          : "";
      }
    }
    if (generation !== this.generation || this.tab !== tab) return;
    const hadFocus = this.graph?.el === document.activeElement;
    this.graph?.destroy();
    this.graph = null;
    this.graphEl.replaceChildren();
    if (!items.length) {
      const empty = document.createElement("p");
      empty.className = "panel-empty";
      empty.textContent = "Type f, D or x² − 2 above, or press Ctrl+Shift+G on a line in a cell.";
      this.graphEl.append(empty);
      return;
    }
    this.graph = new Graph({
      items,
      colours,
      xRange,
      view: tab.view ?? null,
      fill: true,
      legend: false,
      sample: (fn, a, b, n) => this.engine.sample(fn, a, b, n),
      onView: (view) => {
        if (view) tab.view = view;
        else delete tab.view;
        this.onChange();
      },
      onExit: () => this.focusRow(this.rows.length - 1),
    });
    this.graph.el.addEventListener("focus", () => this.onContext(true));
    this.graphEl.append(this.graph.el);
    if (hadFocus) this.graph.focus();
  }
}
