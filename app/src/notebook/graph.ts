// One graph: the result of plot(…) in a cell. Draws functions and points as
// SVG, re-samples functions from the engine whenever the view changes, and is
// driven by the keyboard (trace, zoom, pan) as well as the mouse.
import { convertLatexToMarkup } from "mathlive";
import type { DrawnItem, Feature } from "../engine/giac-session";
import { autoY, formatNumber, niceStep, nudge, pointsX, segments, sliderRange, ticks, type View } from "./graph-math";

export type { View };

const HEIGHT = 320;
const SVG = "http://www.w3.org/2000/svg";
const COLOURS = 6; // --plot-1 … --plot-6 in style.css

export type GraphOptions = {
  items: DrawnItem[];
  /** The default window's x range. */
  xRange: [number, number];
  /** A view saved with the cell (zoomed or panned); null for the automatic one. */
  view: View | null;
  sample: (fn: string, a: number, b: number, n: number) => Promise<number[]>;
  /** The user zoomed or panned (view), or reset to the automatic view (null). */
  onView: (view: View | null) => void;
  /** Esc: back to the cell. */
  onExit: () => void;
  /**
   * Names without a value get a slider under the graph (release 4). The
   * curves read the names when sampled, so after onChange the graph redraws.
   */
  sliders?: { names: string[]; values: Record<string, number>; onChange: (name: string, value: number) => Promise<void> };
  /** Zeros, extrema, y-intercept and intersections of a curve in [a, b] (release 3). */
  features?: (fn: string, others: string[], a: number, b: number) => Promise<Feature[]>;
  /** Fill the height of the container (the panel); otherwise a fixed 320 px. */
  fill?: boolean;
  /** Show the legend of chips (the panel's list shows the colours instead). */
  legend?: boolean;
  /** Colour slot per item, when it isn't the item's position (panel rows that failed). */
  colours?: number[];
};

type Trace = { item: number; x: number; index: number };

function svg<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number> = {}): SVGElementTagNameMap[K] {
  const el = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  return el;
}

export class Graph {
  readonly el: HTMLDivElement;
  private plot: SVGSVGElement;
  private readout: HTMLDivElement;
  private view: View | null = null;
  private auto: View | null = null;
  /** Per item: the x values and samples last drawn (functions only). */
  private samples = new Map<number, { xs: number[]; ys: number[] }>();
  private trace: Trace | null = null;
  private traceY: number | null = null;
  /** The traced curve's points worth knowing in the view; Tab jumps between them. */
  private found: { item: number; others: number[]; list: Feature[] } | null = null;
  /** The point the trace jumped to with Tab, named in the readout. */
  private atFeature: Feature | null = null;
  private featureTimer: number | undefined;
  private generation = 0;
  private resampleTimer: number | undefined;
  private width = 0;
  private height = HEIGHT;
  private resizeObserver: ResizeObserver;

  constructor(private options: GraphOptions) {
    this.el = document.createElement("div");
    this.el.className = "graph";
    this.el.tabIndex = 0;
    this.el.setAttribute("role", "img");
    this.el.setAttribute("aria-label", "Graph. Arrow keys trace, + and − zoom, Esc returns to the cell.");
    this.plot = svg("svg", { class: "graph-plot", height: HEIGHT });
    if (options.legend === false) this.el.classList.add("no-legend");
    if (options.fill) {
      this.el.classList.add("fill");
      this.plot.removeAttribute("height");
    }
    const legend = document.createElement("div");
    legend.className = "graph-legend";
    options.items.forEach((item, i) => {
      const chip = document.createElement("span");
      chip.className = "graph-chip";
      chip.style.setProperty("--colour", this.colour(i));
      chip.innerHTML = convertLatexToMarkup(item.label);
      legend.append(chip);
    });
    this.readout = document.createElement("div");
    this.readout.className = "graph-readout";
    this.el.append(legend, this.plot, this.buildSliders(), this.readout);
    this.showHint();

    this.el.addEventListener("keydown", (e) => this.onKey(e));
    this.el.addEventListener("focus", () => this.showHint());
    this.addMouse();
    this.resizeObserver = new ResizeObserver(() => {
      const width = this.plot.clientWidth;
      const height = this.options.fill ? Math.max(120, this.plot.clientHeight) : HEIGHT;
      if (width && (width !== this.width || height !== this.height)) {
        this.width = width;
        this.height = height;
        if (this.view) this.render();
        this.scheduleResample(0);
      }
    });
    this.resizeObserver.observe(this.el);
    void this.load();
  }

  destroy() {
    this.resizeObserver.disconnect();
    clearTimeout(this.resampleTimer);
    this.generation++;
  }

  focus() {
    this.el.focus();
  }

  /** The view now shown, for saving; null while it is the automatic one. */
  private get custom(): View | null {
    return this.view && this.view !== this.auto ? this.view : null;
  }

  // ---- data ---------------------------------------------------------------

  private get functions(): [number, Extract<DrawnItem, { kind: "function" }>][] {
    return this.options.items.flatMap((item, i) => (item.kind === "function" ? [[i, item] as [number, typeof item]] : []));
  }

  private get allPoints(): [number, number][] {
    return this.options.items.flatMap((item) => (item.kind === "points" ? item.points : []));
  }

  private sampleCount(): number {
    return Math.max(100, Math.min(800, Math.round((this.width || 600) / 2)));
  }

  /** First drawing: sample the default x range, then fit y (unless a saved view says otherwise). */
  private async load() {
    const generation = ++this.generation;
    const points = this.allPoints;
    let [a, b] = this.options.xRange;
    if (!this.functions.length && points.length) [a, b] = pointsX(points);
    if (this.options.view) [a, b] = [this.options.view.xmin, this.options.view.xmax];
    await this.sampleAll(a, b, generation);
    if (generation !== this.generation) return;
    const [ymin, ymax] = autoY([...this.samples.values()].map((s) => s.ys), points);
    this.auto = { xmin: a, xmax: b, ymin, ymax };
    this.view = this.options.view ?? this.auto;
    this.render();
  }

  private async sampleAll(a: number, b: number, generation: number) {
    const n = this.sampleCount();
    for (const [i, item] of this.functions) {
      const ys = await this.options.sample(item.fn, a, b, n);
      if (generation !== this.generation) return;
      this.samples.set(i, { xs: ys.map((_, k) => a + ((b - a) * k) / n), ys });
    }
  }

  /** Re-sample for the current view, shortly after the last change. */
  private scheduleResample(delay = 120) {
    clearTimeout(this.resampleTimer);
    this.resampleTimer = window.setTimeout(async () => {
      if (!this.view) return;
      const generation = ++this.generation;
      // A little beyond the edges, so a pan shows curve before new samples arrive.
      const span = this.view.xmax - this.view.xmin;
      await this.sampleAll(this.view.xmin - span * 0.25, this.view.xmax + span * 0.25, generation);
      if (generation === this.generation) this.render();
    }, delay);
  }

  private setView(view: View, save = true) {
    this.view = view;
    this.render();
    this.scheduleResample();
    this.scheduleFeatures();
    if (save) this.options.onView(this.custom);
  }

  /** After a slider moved: the curves, their points and the trace follow. */
  redraw() {
    this.scheduleResample(0);
    this.scheduleFeatures(0);
    if (this.trace) void this.moveTrace(0);
  }

  // ---- sliders --------------------------------------------------------------

  private sliderInputs: HTMLInputElement[] = [];

  private buildSliders(): HTMLElement {
    const box = document.createElement("div");
    box.className = "graph-sliders";
    const sliders = this.options.sliders;
    if (!sliders) return box;
    sliders.names.forEach((name, i) => {
      const row = document.createElement("label");
      row.className = "graph-slider";
      const label = document.createElement("span");
      label.className = "graph-slider-name";
      // ab_0 is drawn as ab₀, like the name in the cell.
      label.innerHTML = convertLatexToMarkup(name.replace(/_([A-Za-z0-9]+)$/, "_{$1}"));
      const input = document.createElement("input");
      input.type = "range";
      input.setAttribute("aria-label", `Slider for ${name}`);
      const shown = document.createElement("span");
      shown.className = "graph-slider-value";
      const set = (value: number) => {
        const { min, max, step } = sliderRange(value);
        input.min = String(min);
        input.max = String(max);
        input.step = String(step);
        input.value = String(value);
        shown.textContent = formatNumber(value);
        sliders.values[name] = value;
      };
      const change = async (value: number) => {
        set(value);
        await sliders.onChange(name, value);
        this.redraw();
      };
      set(sliders.values[name] ?? 1);
      input.addEventListener("input", () => void change(Number(input.value)));
      input.addEventListener("keydown", (e) => {
        const handled = () => {
          e.preventDefault();
          e.stopPropagation();
        };
        if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
          handled();
          const steps = (e.key === "ArrowLeft" ? -1 : 1) * (e.shiftKey ? 10 : 1);
          void change(nudge(sliders.values[name], steps, Number(input.step)));
        } else if (e.key === "ArrowUp") {
          handled();
          if (i > 0) this.sliderInputs[i - 1].focus();
          else this.el.focus();
        } else if (e.key === "ArrowDown") {
          handled();
          this.sliderInputs[i + 1]?.focus();
        } else if (e.key === "Escape") {
          handled();
          this.el.focus();
        }
      });
      row.append(label, input, shown);
      box.append(row);
      this.sliderInputs.push(input);
    });
    return box;
  }

  // ---- drawing ------------------------------------------------------------

  private render() {
    const view = this.view;
    if (!view || !this.width) return;
    const w = this.width;
    const h = this.height;
    const sx = (x: number) => ((x - view.xmin) / (view.xmax - view.xmin)) * w;
    const sy = (y: number) => h - ((y - view.ymin) / (view.ymax - view.ymin)) * h;
    this.plot.replaceChildren();
    this.plot.setAttribute("viewBox", `0 0 ${w} ${h}`);

    const grid = svg("g", { class: "graph-grid" });
    const labels = svg("g", { class: "graph-labels" });
    const xStep = niceStep(view.xmax - view.xmin, Math.max(2, Math.floor(w / 80)));
    const yStep = niceStep(view.ymax - view.ymin, Math.max(2, Math.floor(h / 50)));
    const x0 = Math.min(Math.max(sx(0), 0), w);
    const y0 = Math.min(Math.max(sy(0), 0), h);
    for (const x of ticks(view.xmin, view.xmax, xStep)) {
      grid.append(svg("line", { x1: sx(x), x2: sx(x), y1: 0, y2: h }));
      // Labels at the edges are pulled in, so they are not cut off.
      const anchor = sx(x) < 16 ? "start" : sx(x) > w - 16 ? "end" : "middle";
      if (x !== 0) labels.append(this.label(formatNumber(x, 4), anchor === "start" ? sx(x) + 2 : anchor === "end" ? sx(x) - 2 : sx(x), Math.min(y0 + 14, h - 4), anchor));
    }
    for (const y of ticks(view.ymin, view.ymax, yStep)) {
      grid.append(svg("line", { x1: 0, x2: w, y1: sy(y), y2: sy(y) }));
      if (y !== 0) labels.append(this.label(formatNumber(y, 4), x0 < w - 40 ? x0 + 4 : x0 - 4, sy(y) + 4, x0 < w - 40 ? "start" : "end"));
    }
    const axes = svg("g", { class: "graph-axes" });
    axes.append(svg("line", { x1: 0, x2: w, y1: y0, y2: y0 }), svg("line", { x1: x0, x2: x0, y1: 0, y2: h }));
    this.plot.append(grid, axes, labels);

    this.options.items.forEach((item, i) => {
      const colour = this.colour(i);
      if (item.kind === "function") {
        const s = this.samples.get(i);
        if (!s) return;
        const d = segments(s.xs, s.ys, view)
          .map((seg) => seg.map(([x, y], k) => `${k ? "L" : "M"}${sx(x).toFixed(1)},${sy(y).toFixed(1)}`).join(""))
          .join("");
        this.plot.append(svg("path", { d, class: "graph-curve", stroke: colour }));
      } else {
        for (const [x, y] of item.points) this.plot.append(svg("circle", { cx: sx(x), cy: sy(y), r: 4, class: "graph-point", fill: colour }));
      }
    });

    if (this.trace && this.found?.item === this.trace.item) {
      for (const f of this.found.list) this.plot.append(svg("circle", { cx: sx(f.x), cy: sy(f.y), r: 4, class: "graph-feature" }));
    }

    if (this.trace && this.traceY !== null && Number.isFinite(this.traceY)) {
      const colour = this.colour(this.trace.item);
      this.plot.append(svg("circle", { cx: sx(this.trace.x), cy: sy(this.traceY), r: 5.5, class: "graph-trace", stroke: colour }));
    }
  }

  private colour(item: number): string {
    const slot = this.options.colours?.[item] ?? item;
    return `var(--plot-${(slot % COLOURS) + 1})`;
  }

  private label(text: string, x: number, y: number, anchor: string) {
    const t = svg("text", { x, y, "text-anchor": anchor });
    t.textContent = text;
    return t;
  }

  private showHint() {
    if (this.trace) return;
    const sliders = this.sliderInputs.length ? " · S sliders" : "";
    this.readout.textContent = `← → trace · ↑ ↓ switch curve · + − zoom · Ctrl+arrows pan · 0 reset${sliders} · Esc back`;
  }

  // ---- trace --------------------------------------------------------------

  private traceStep(): number {
    const v = this.view!;
    return niceStep(v.xmax - v.xmin, 100);
  }

  /** Starts tracing the item, or moves along it by `steps` (functions) / points. */
  private async moveTrace(steps: number, item = this.trace?.item ?? 0) {
    const view = this.view;
    if (!view || !this.options.items.length) return;
    this.atFeature = null;
    const target = this.options.items[item];
    let trace: Trace;
    if (target.kind === "points") {
      const sorted = target.points;
      const index = this.trace?.item === item ? (this.trace.index + steps + sorted.length) % sorted.length : 0;
      trace = { item, index, x: sorted[index][0] };
      this.trace = trace;
      this.traceY = sorted[index][1];
    } else {
      const step = this.traceStep();
      const start = this.trace ? this.trace.x : Math.min(Math.max(0, view.xmin), view.xmax);
      const x = Math.round((start + steps * step) / step) * step;
      trace = { item, index: 0, x: Math.abs(x) < step * 1e-9 ? 0 : x };
      this.trace = trace;
      const [y] = await this.options.sample(target.fn, trace.x, trace.x, 1);
      if (this.trace !== trace) return;
      this.traceY = y ?? NaN;
    }
    this.follow();
    this.render();
    this.showTrace();
    if (target.kind === "function" && this.found?.item !== item) this.scheduleFeatures(0);
  }

  /** The readout: the traced curve, and its coordinates or, after Tab, what the point is (exact). */
  private showTrace() {
    const trace = this.trace;
    if (!trace) return;
    const target = this.options.items[trace.item];
    const y = this.traceY;
    this.readout.innerHTML = "";
    const name = document.createElement("span");
    name.className = "graph-readout-name";
    name.innerHTML = convertLatexToMarkup(target.label);
    const f = this.atFeature;
    if (!f) {
      const hint = target.kind === "function" && this.found?.list.length ? "   Tab: zeros, max/min, intersections" : "";
      this.readout.append(name, `  x = ${formatNumber(trace.x)},  y = ${y !== null && Number.isFinite(y) ? formatNumber(y) : "undefined"}${hint}`);
      return;
    }
    const what = document.createElement("span");
    what.className = "graph-readout-kind";
    const other = f.other !== undefined ? this.options.items[this.found!.others[f.other]] : null;
    what.textContent = { zero: "Zero", yint: "y-intercept", min: "Minimum", max: "Maximum", intersection: "Intersection" }[f.kind];
    const coordinate = (axis: string, latex: string, value: number) => {
      const exact = convertLatexToMarkup(latex);
      // A whole number or a decimal needs no ≈ beside it.
      const approx = /\d\.\d|\\cdot 10\^/.test(latex) || String(value) === latex ? "" : ` ≈ ${formatNumber(value)}`;
      return `${axis} = ${exact}${approx}`;
    };
    const values = document.createElement("span");
    values.className = "graph-readout-values";
    values.innerHTML = `${coordinate("x", f.xLatex, f.x)},&nbsp; ${coordinate("y", f.yLatex, f.y)}`;
    this.readout.append(name, "  ", what);
    if (other) {
      const with_ = document.createElement("span");
      with_.innerHTML = ` with ${convertLatexToMarkup(other.label)}`;
      this.readout.append(with_);
    }
    this.readout.append("   ", values);
  }

  /** Finds the traced curve's points worth knowing in the view, shortly after it settles. */
  private scheduleFeatures(delay = 250) {
    clearTimeout(this.featureTimer);
    const find = this.options.features;
    const trace = this.trace;
    if (!find || !trace || this.options.items[trace.item]?.kind !== "function") return;
    this.featureTimer = window.setTimeout(async () => {
      const view = this.view;
      if (!view || this.trace?.item !== trace.item) return;
      const items = this.options.items;
      const target = items[trace.item] as Extract<DrawnItem, { kind: "function" }>;
      const others = items.flatMap((it, i) => (it.kind === "function" && i !== trace.item ? [i] : []));
      const fns = others.map((i) => (items[i] as Extract<DrawnItem, { kind: "function" }>).fn);
      const list = await find(target.fn, fns, view.xmin, view.xmax);
      if (this.trace?.item !== trace.item || this.view !== view) return;
      this.found = { item: trace.item, others, list };
      this.render();
      if (!this.atFeature) this.showTrace();
    }, delay);
  }

  /** Tab / Shift+Tab: the trace jumps to the next / previous point worth knowing. */
  private jumpToFeature(direction: 1 | -1): boolean {
    const trace = this.trace;
    const list = this.found && trace && this.found.item === trace.item ? this.found.list : [];
    if (!trace || !list.length) return false;
    const eps = (this.view!.xmax - this.view!.xmin) * 1e-9;
    const at = this.atFeature ? list.indexOf(this.atFeature) : -1;
    let next: Feature | undefined;
    if (at >= 0) next = list[(at + direction + list.length) % list.length];
    else next = direction > 0 ? (list.find((f) => f.x > trace.x + eps) ?? list[0]) : ([...list].reverse().find((f) => f.x < trace.x - eps) ?? list[list.length - 1]);
    this.trace = { ...trace, x: next.x };
    this.traceY = next.y;
    this.atFeature = next;
    this.render();
    this.showTrace();
    return true;
  }

  /** Keeps the traced point on screen by panning. */
  private follow() {
    const view = this.view!;
    const { x } = this.trace!;
    const y = this.traceY;
    const w = view.xmax - view.xmin;
    const h = view.ymax - view.ymin;
    let next = view;
    if (x < view.xmin || x > view.xmax) next = { ...next, xmin: x - w / 2, xmax: x + w / 2 };
    if (y !== null && Number.isFinite(y) && (y < view.ymin || y > view.ymax)) next = { ...next, ymin: y - h / 2, ymax: y + h / 2 };
    if (next !== view) this.setView(next);
  }

  // ---- keys and mouse -----------------------------------------------------

  private onKey(e: KeyboardEvent) {
    const view = this.view;
    if (!view) return;
    const mod = e.ctrlKey || e.metaKey;
    const w = view.xmax - view.xmin;
    const h = view.ymax - view.ymin;
    const handled = () => {
      e.preventDefault();
      e.stopPropagation();
    };
    if (e.key === "Escape") {
      handled();
      this.options.onExit();
    } else if ((e.key === "s" || e.key === "S") && !mod && !e.altKey && this.sliderInputs.length) {
      handled();
      this.sliderInputs[0].focus();
    } else if (e.key === "Tab" && !mod && !e.altKey) {
      // Only while tracing a curve with points to visit; otherwise Tab moves focus as usual.
      if (this.jumpToFeature(e.shiftKey ? -1 : 1)) handled();
    } else if (mod && e.key.startsWith("Arrow")) {
      handled();
      const dx = e.key === "ArrowLeft" ? -0.25 * w : e.key === "ArrowRight" ? 0.25 * w : 0;
      const dy = e.key === "ArrowDown" ? -0.25 * h : e.key === "ArrowUp" ? 0.25 * h : 0;
      this.setView({ xmin: view.xmin + dx, xmax: view.xmax + dx, ymin: view.ymin + dy, ymax: view.ymax + dy });
    } else if ((e.key === "ArrowLeft" || e.key === "ArrowRight") && !e.altKey) {
      handled();
      const direction = e.key === "ArrowLeft" ? -1 : 1;
      void this.moveTrace(this.trace ? direction * (e.shiftKey ? 10 : 1) : 0);
    } else if ((e.key === "ArrowUp" || e.key === "ArrowDown") && !e.altKey && !e.shiftKey) {
      handled();
      const n = this.options.items.length;
      const item = this.trace ? (this.trace.item + (e.key === "ArrowDown" ? 1 : -1) + n) % n : 0;
      const x = this.trace?.x;
      this.trace = x === undefined ? null : { item, x, index: 0 };
      void this.moveTrace(0, item);
    } else if (e.key === "+" || e.key === "=" || e.key === "-" || e.key === "_") {
      if (mod) return; // Ctrl+plus/minus: the app's zoom
      handled();
      const factor = e.key === "+" || e.key === "=" ? 0.5 : 2;
      const cx = this.trace?.x ?? (view.xmin + view.xmax) / 2;
      const cy = this.traceY !== null && Number.isFinite(this.traceY) && this.trace ? this.traceY : (view.ymin + view.ymax) / 2;
      this.zoom(factor, cx, cy);
    } else if (e.key === "0" && !mod) {
      handled();
      if (this.auto) {
        this.view = this.auto;
        this.options.onView(null);
        this.render();
        this.scheduleResample();
      }
    }
  }

  private zoom(factor: number, cx: number, cy: number) {
    const v = this.view!;
    this.setView({
      xmin: cx - (cx - v.xmin) * factor,
      xmax: cx + (v.xmax - cx) * factor,
      ymin: cy - (cy - v.ymin) * factor,
      ymax: cy + (v.ymax - cy) * factor,
    });
  }

  /** Plane coordinates under the mouse. */
  private at(e: MouseEvent): [number, number] {
    const v = this.view!;
    const r = this.plot.getBoundingClientRect();
    return [v.xmin + ((e.clientX - r.left) / r.width) * (v.xmax - v.xmin), v.ymax - ((e.clientY - r.top) / r.height) * (v.ymax - v.ymin)];
  }

  private addMouse() {
    this.plot.addEventListener(
      "wheel",
      (e) => {
        if (!this.view) return;
        e.preventDefault();
        const [x, y] = this.at(e);
        this.zoom(e.deltaY > 0 ? 1.25 : 0.8, x, y);
      },
      { passive: false },
    );
    let drag: { x: number; y: number; view: View } | null = null;
    this.plot.addEventListener("pointerdown", (e) => {
      if (!this.view || e.button !== 0) return;
      this.el.focus();
      drag = { x: e.clientX, y: e.clientY, view: this.view };
      this.plot.setPointerCapture(e.pointerId);
    });
    this.plot.addEventListener("pointermove", (e) => {
      if (!this.view) return;
      if (drag) {
        const r = this.plot.getBoundingClientRect();
        const v = drag.view;
        const dx = ((e.clientX - drag.x) / r.width) * (v.xmax - v.xmin);
        const dy = ((e.clientY - drag.y) / r.height) * (v.ymax - v.ymin);
        this.view = { xmin: v.xmin - dx, xmax: v.xmax - dx, ymin: v.ymin + dy, ymax: v.ymax + dy };
        this.render();
        this.scheduleResample();
      } else if (!this.trace) {
        const [x, y] = this.at(e);
        this.readout.textContent = `x = ${formatNumber(x, 4)},  y = ${formatNumber(y, 4)}`;
      }
    });
    this.plot.addEventListener("pointerup", () => {
      if (drag && this.view !== drag.view) this.options.onView(this.custom);
      drag = null;
    });
    this.plot.addEventListener("pointerleave", () => {
      if (!drag) this.showHint();
    });
  }
}
