import { describe, expect, it } from "vitest";
import { CATALOG } from "../ui/commands";
import { definedSuggestion, functionSuggestions, ghostText, suggest, SYMBOLS, type Suggestion } from "./suggestions";

const functions = functionSuggestions(CATALOG);
const own = (...list: (Suggestion | null)[]) => list.filter((s): s is Suggestion => !!s);

describe("functionSuggestions", () => {
  it("takes each name once, everyday templates first", () => {
    const solve = functions.filter((s) => s.name === "solve");
    expect(solve).toHaveLength(1);
    expect(solve[0].hint).toBe("solve(…, x)");
    expect(solve[0].latex).toBe("\\operatorname{solve}\\left(\\placeholder{},x\\right)");
  });
  it("includes the trig and log functions", () => {
    expect(functions.map((s) => s.name)).toEqual(expect.arrayContaining(["sin", "cos", "ln", "log", "plot"]));
  });
});

describe("suggest", () => {
  const lists = (mine: Suggestion[] = []) => [mine, functions, SYMBOLS];

  it("needs two letters", () => {
    expect(suggest("s", lists())).toBeNull();
    expect(suggest("so", lists())?.name).toBe("solve");
  });
  it("prefers the notebook's own names", () => {
    const mine = own(definedSuggestion("solution1"));
    expect(suggest("so", lists(mine))?.name).toBe("solution1");
    expect(ghostText("sol", suggest("sol", lists(mine))!)).toBe("ution1");
  });
  it("a whole name of your own gets no suggestion, a whole function does", () => {
    const mine = own(definedSuggestion("area", ["r"]), definedSuggestion("rate"));
    expect(suggest("rate", lists(mine))).toBeNull();
    expect(suggest("area", lists(mine))?.hint).toBe("area(r)");
    expect(suggest("sin", lists())?.latex).toBe("\\sin\\left(\\placeholder{}\\right)");
  });
  it("Greek letters show what they become", () => {
    const s = suggest("th", lists())!;
    expect(s.name).toBe("theta");
    expect(ghostText("th", s)).toBe("eta θ");
    expect(ghostText("pi", suggest("pi", lists())!)).toBe(" π");
  });
  it("is case-sensitive", () => {
    expect(suggest("De", lists())?.name).toBe("Delta");
    expect(suggest("de", lists())?.name).not.toBe("Delta");
  });
  it("nothing for letters no name starts with", () => {
    expect(suggest("qz", lists())).toBeNull();
  });
});

describe("definedSuggestion", () => {
  it("a function gets a box per parameter", () => {
    expect(definedSuggestion("vol", ["r", "h"])).toMatchObject({ latex: "vol\\left(\\placeholder{},\\placeholder{}\\right)", hint: "vol(r, h)" });
  });
  it("skips one-letter names and names that aren't a run of letters", () => {
    expect(definedSuggestion("f", ["x"])).toBeNull();
    expect(definedSuggestion("b_0")).toBeNull();
  });
});
