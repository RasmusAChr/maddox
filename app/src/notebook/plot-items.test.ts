import { describe, expect, it } from "vitest";
import { latexToGiac } from "../engine/latex-to-giac";
import { localise, plotItemsFromLine, readPanelRow, splitLatexArgs } from "./plot-items";

describe("plotItemsFromLine (Ctrl+Shift+G)", () => {
  it.each([
    ["f\\left(x\\right)\\coloneq x^2-2", ["f"]],
    ["D\\coloneq\\left[\\left(1,3\\right),\\left(3,8\\right)\\right]", ["D"]],
    ["y_1\\coloneq 3x", ["y_1"]],
    ["\\operatorname{\\mathrm{plot}}\\left(f,x^2,\\frac{1}{x}\\right)", ["f", "x^2", "\\frac{1}{x}"]],
    ["\\operatorname{plot}\\left(\\left(1,3\\right),g\\right)", ["\\left(1,3\\right)", "g"]],
    ["plot\\left(f,x\\right)", ["f", "x"]],
    ["x^2-2", ["x^2-2"]],
    ["\\text{\\# Area}", []],
    ["", []],
  ])("%s", (line, items) => expect(plotItemsFromLine(line)).toEqual(items));

  it("reads graph-panel rows", () => {
    expect(readPanelRow(latexToGiac("g\\left(x\\right)=2x+3"))).toEqual({ kind: "function", name: "g", param: "x", body: "2*x+3" });
    expect(readPanelRow(latexToGiac("a=3"))).toEqual({ kind: "value", name: "a", body: "3" });
    expect(readPanelRow(latexToGiac("y=x^2"))).toEqual({ kind: "expression", body: "x^(2)" });
    expect(readPanelRow(latexToGiac("g\\left(0\\right)"))).toEqual({ kind: "expression", body: "g(0)" });
    expect(readPanelRow(latexToGiac("x\\le3"))).toEqual({ kind: "expression", body: "x<=3" });
    expect(readPanelRow(latexToGiac("g\\left(x\\right)\\coloneq2x"))).toMatchObject({ kind: "error", error: expect.stringContaining("Use = to define g in this graph") });
    expect(readPanelRow(latexToGiac("x=3"))).toMatchObject({ kind: "error" });
    expect(localise("g(0)+ga+a*g(x)", ["g", "a"])).toBe("maddox_local_g(0)+ga+maddox_local_a*maddox_local_g(x)");
  });

  it("splits only at top-level commas", () => {
    expect(splitLatexArgs("\\left(1,2\\right),\\frac{a,b}{c},x")).toEqual(["\\left(1,2\\right)", "\\frac{a,b}{c}", "x"]);
  });
});
