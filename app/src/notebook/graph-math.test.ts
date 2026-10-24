import { describe, expect, it } from "vitest";
import { autoY, formatNumber, niceStep, pointsX, segments, ticks } from "./graph-math";

describe("graph arithmetic", () => {
  it("tick steps are 1, 2 or 5 × 10ⁿ", () => {
    expect(niceStep(20, 10)).toBe(2);
    expect(niceStep(720, 8)).toBe(100);
    expect(niceStep(1, 10)).toBe(0.1);
    expect(ticks(-1, 1, 0.5)).toEqual([-1, -0.5, 0, 0.5, 1]);
  });

  it("y fits the curves, ignoring an asymptote's spikes, and shows 0 when near", () => {
    const xs = Array.from({ length: 101 }, (_, k) => -10 + k * 0.2);
    const [lo, hi] = autoY([xs.map((x) => x * x - 2)], []);
    expect(lo).toBeLessThan(-2);
    expect(hi).toBeGreaterThan(90);
    const [l2, h2] = autoY([xs.map((x) => (x === 0 ? NaN : 1 / x))], []);
    expect(h2).toBeLessThan(10);
    expect(l2).toBeGreaterThan(-10);
    expect(autoY([[3, 3, 3]], [])).toEqual([2, 4]);
    expect(autoY([], [[1, 1], [3, 8]])[0]).toBeLessThanOrEqual(0);
    expect(autoY([], [[1, 30], [3, 32]])[0]).toBeGreaterThan(20);
  });

  it("points alone get a window around them", () => {
    const [lo, hi] = pointsX([[1, 3], [3, 8], [8, 15]]);
    expect(lo).toBeLessThanOrEqual(0);
    expect(hi).toBeGreaterThan(8);
  });

  it("curves break where there is no value and at asymptotes, not on steep lines", () => {
    const view = { xmin: -2, xmax: 2, ymin: -5, ymax: 5 };
    expect(segments([-1, 0, 1, 2], [1, NaN, 1, 2], view)).toHaveLength(1);
    expect(segments([-2, -1, 1, 2], [-50, -60, 60, 50], view)).toHaveLength(2);
    expect(segments([0, 1, 2], [-4, 0, 4], view)).toHaveLength(1);
  });

  it("numbers read well", () => {
    expect(formatNumber(0.25)).toBe("0.25");
    expect(formatNumber(-1.5)).toBe("−1.5");
    expect(formatNumber(1 / 3)).toBe("0.333333");
    expect(formatNumber(1e-15)).toBe("0");
    expect(formatNumber(2)).toBe("2");
  });
});
