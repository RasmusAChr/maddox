// The arithmetic behind a graph: windows, tick marks, and where a sampled
// curve must break. Free of the DOM so it can be unit-tested.

/** The part of the plane a graph shows. */
export type View = { xmin: number; xmax: number; ymin: number; ymax: number };

/** A tick spacing of 1, 2 or 5 × 10ⁿ, giving at most `count` ticks over `span`. */
export function niceStep(span: number, count: number): number {
  const raw = span / Math.max(1, count);
  const power = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map((m) => m * power).find((s) => s >= raw);
  return step ?? 10 * power;
}

/** Multiples of `step` from min to max. */
export function ticks(min: number, max: number, step: number): number[] {
  const out: number[] = [];
  for (let k = Math.ceil(min / step); k * step <= max + step * 1e-9; k++) out.push(Math.abs(k * step) < step * 1e-9 ? 0 : k * step);
  return out;
}

/**
 * A y range that shows the curves and points well: the middle 96 % of the
 * sampled values (so 1/x near 0 doesn't flatten everything), 0 when it is
 * close, and a margin.
 */
export function autoY(series: number[][], points: [number, number][]): [number, number] {
  const values: number[] = [];
  for (const ys of series) {
    const finite = ys.filter(Number.isFinite).sort((a, b) => a - b);
    if (finite.length >= 20) values.push(finite[Math.floor(finite.length * 0.02)], finite[Math.ceil(finite.length * 0.98) - 1]);
    else values.push(...finite);
  }
  values.push(...points.map((p) => p[1]));
  if (!values.length) return [-10, 10];
  let lo = Math.min(...values);
  let hi = Math.max(...values);
  if (hi - lo < 1e-9) return [lo - 1, hi + 1];
  if (lo > 0 && lo < (hi - lo) * 0.5) lo = 0;
  if (hi < 0 && -hi < (hi - lo) * 0.5) hi = 0;
  const pad = (hi - lo) * 0.1;
  return [lo - pad, hi + pad];
}

/** A window around points alone, with a margin and the origin when it is near. */
export function pointsX(points: [number, number][]): [number, number] {
  const xs = points.map((p) => p[0]);
  let lo = Math.min(...xs);
  let hi = Math.max(...xs);
  if (hi - lo < 1e-9) [lo, hi] = [lo - 1, hi + 1];
  if (lo > 0 && lo < (hi - lo) * 0.5) lo = 0;
  if (hi < 0 && -hi < (hi - lo) * 0.5) hi = 0;
  const pad = (hi - lo) * 0.1;
  return [lo - pad, hi + pad];
}

/**
 * The pieces of a sampled curve to draw: it breaks where the function has
 * no value (NaN), and at a jump far off the screen, which is an asymptote
 * (1/x, tan x) and not a steep line.
 */
export function segments(xs: number[], ys: number[], view: View): [number, number][][] {
  const span = view.ymax - view.ymin;
  const outside = (y: number) => y < view.ymin || y > view.ymax;
  const out: [number, number][][] = [];
  let current: [number, number][] = [];
  for (let i = 0; i < xs.length; i++) {
    const y = ys[i];
    const prev = ys[i - 1];
    const jump = i > 0 && Number.isFinite(prev) && Number.isFinite(y) && Math.abs(y - prev) > 2 * span && (outside(y) || outside(prev));
    if (!Number.isFinite(y) || jump) {
      if (current.length > 1) out.push(current);
      current = [];
      if (!Number.isFinite(y)) continue;
    }
    // Far-off values only steer the line's direction; keep the numbers small.
    current.push([xs[i], Math.max(view.ymin - 10 * span, Math.min(view.ymax + 10 * span, y))]);
  }
  if (current.length > 1) out.push(current);
  return out;
}

/** A coordinate for people: six significant digits, no trailing zeros, no −0. */
export function formatNumber(v: number, digits = 6): string {
  if (!Number.isFinite(v)) return "undefined";
  if (Math.abs(v) < 1e-12) return "0";
  const text = Math.abs(v) >= 1e6 || Math.abs(v) < 1e-4 ? v.toExponential(digits - 1) : v.toPrecision(digits);
  return text.replace(/(\.\d*?)0+(e|$)/, "$1$2").replace(/\.(e|$)/, "$1").replace("-", "−");
}
