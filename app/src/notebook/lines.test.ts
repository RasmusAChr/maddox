import { describe, expect, it } from "vitest";
import { isTextLine, splitLines, textToLatex } from "./lines";

describe("splitLines", () => {
  it.each([
    ["2+3", ["2+3"]],
    ["", [""]],
    ["\\displaylines{2+3\\\\ x^2}", ["2+3", "x^2"]],
    ["2+3\\\\ x^2", ["2+3", "x^2"]],
    ["\\displaylines{1\\\\ \\\\ 3}", ["1", "", "3"]],
    ["\\displaylines{\\begin{pmatrix}1&2\\\\3&4\\end{pmatrix}\\\\ x}", ["\\begin{pmatrix}1&2\\\\3&4\\end{pmatrix}", "x"]],
    ["\\begin{pmatrix}1 & 2\\\\3 & 4\\end{pmatrix}\\\\ x", ["\\begin{pmatrix}1 & 2\\\\3 & 4\\end{pmatrix}", "x"]],
    ["\\displaylines{\\text{\\# Area}\\\\ r\\coloneq 3}", ["\\text{\\# Area}", "r\\coloneq 3"]],
    ["\\frac{1}{2}\\\\ \\{1\\}", ["\\frac{1}{2}", "\\{1\\}"]],
    // \displaylines that does not wrap the whole cell is left alone
    ["\\displaylines{a}+\\displaylines{b}", ["\\displaylines{a}+\\displaylines{b}"]],
  ])("%s", (latex, lines) => expect(splitLines(latex)).toEqual(lines));
});

describe("isTextLine", () => {
  it.each([
    ["\\text{\\# Area of the circle}", true],
    ["\\text{ \\# note}", true],
    ["\\#", true],
    ["r\\coloneq 3", false],
    ["\\text{abc}", false],
    ["x\\#", false],
  ])("%s", (line, text) => expect(isTextLine(line)).toBe(text));
});

describe("textToLatex", () => {
  it("makes one text line per line and escapes LaTeX specials", () => {
    expect(textToLatex("Area")).toBe("\\text{\\# Area}");
    expect(textToLatex("a_b {c}\nline 2")).toBe("\\displaylines{\\text{\\# a\\_b \\{c\\}}\\\\ \\text{\\# line 2}}");
    expect(splitLines(textToLatex("one\ntwo")).every(isTextLine)).toBe(true);
  });
});
