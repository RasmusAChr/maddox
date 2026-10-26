import { describe, expect, it } from "vitest";
import { tidyAsciiMath } from "./plain-text";

describe("tidyAsciiMath", () => {
  it.each([
    ['x=sqrt(2)" or " x=-sqrt(2)', "x=sqrt(2) or x=-sqrt(2)"],
    ["(1)/(2)", "1/2"],
    ["(3)/(x^2+1)", "3/(x^2+1)"],
    ["(x^2+1)/(x-1)", "(x^2+1)/(x-1)"],
    ["x in \\{2, 3\\}", "x in {2, 3}"],
    ["((1,2),(3,4))", "((1,2),(3,4))"],
    ["16pi", "16pi"],
    ["3 m/s", "3 m/s"],
  ])("%s → %s", (ascii, text) => expect(tidyAsciiMath(ascii)).toBe(text));
});
