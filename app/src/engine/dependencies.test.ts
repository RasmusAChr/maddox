import { describe, expect, it } from "vitest";
import { lineNames } from "./dependencies";
import { ANS_VARIABLE, latexToGiac } from "./latex-to-giac";

const names = (latex: string) => lineNames(latexToGiac(latex));

describe("lineNames", () => {
  it("finds what a line assigns and what it uses", () => {
    expect(names("r\\coloneq3")).toEqual({ assigns: ["r"], reads: [], stateful: false });
    expect(names("A\\coloneq\\pi r^2")).toMatchObject({ assigns: ["A"], reads: expect.arrayContaining(["r"]) });
    expect(names("2A")).toMatchObject({ assigns: [], reads: ["A"] });
    expect(names("r\\coloneq r+1")).toMatchObject({ assigns: ["r"], reads: ["r"] });
  });

  it("a function's parameters are its own", () => {
    const f = names("f\\left(x\\right)\\coloneq a\\cdot x^2");
    expect(f.assigns).toEqual(["f"]);
    expect(f.reads).toContain("a");
    expect(f.reads).not.toContain("x");
    expect(names("f\\left(2\\right)").reads).toContain("f");
  });

  it("units and strings are not names; ans is", () => {
    expect(names("5\\mathrm{m}+r").reads).toEqual(["r"]);
    expect(names("20\\mathrm{°C}\\to\\mathrm{°F}").reads).not.toContain("C");
    expect(lineNames(`${ANS_VARIABLE}*2`).reads).toEqual([ANS_VARIABLE]);
  });

  it("restart, purge and assume change the engine", () => {
    expect(lineNames("restart").stateful).toBe(true);
    expect(lineNames("purge(r)").stateful).toBe(true);
    expect(lineNames("assume(x>0)").stateful).toBe(true);
    expect(names("r\\coloneq3").stateful).toBe(false);
  });
});
