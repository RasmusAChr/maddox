import { describe, expect, it } from "vitest";
import { latexToGiac, UnsupportedLatex } from "./latex-to-giac";

const cases: [string, string][] = [
  // arithmetic and juxtaposition
  ["1+2", "1+2"],
  ["2x", "2*x"],
  ["2.5x^{2}", "2.5*x^(2)"],
  ["xy", "xy"],
  ["x\\cdot y", "x*y"],
  ["2\\pi r", "2*pi*r"],
  ["\\left(x+1\\right)x", "(x+1)*x"],
  ["\\left(x+1\\right)\\left(x-1\\right)", "(x+1)*(x-1)"],
  ["f\\left(3\\right)", "f(3)"],
  ["5!", "5!"],
  ["x^{2}y", "x^(2)*y"],
  ["x_1+x_{2}", "x_1+x_2"],
  ["\\frac{1}{3}+\\frac{1}{6}", "((1)/(3))+((1)/(6))"],
  ["\\frac{x}{2}y", "((x)/(2))*y"],
  // MathLive drops braces around one-character arguments
  ["\\frac13+\\frac16", "((1)/(3))+((1)/(6))"],
  ["\\frac{1}{3+\\frac{1}{6}}", "((1)/(3+((1)/(6))))"],
  ["x^23", "x^(2)*3"],
  ["\\sqrt2", "sqrt(2)"],
  ["\\frac{d}{dx}x^3", "diff(x^(3),x)"],
  // functions
  ["\\sin\\left(x\\right)\\cos\\left(x\\right)", "sin(x)*cos(x)"],
  ["\\sin x", "sin(x)"],
  ["\\sin 2x+1", "sin(2*x)+1"],
  ["\\sin^{2}x", "(sin(x))^(2)"],
  ["\\sin^{-1}\\left(1\\right)", "asin(1)"],
  ["\\arctan\\left(1\\right)", "atan(1)"],
  ["\\ln\\left(e\\right)", "ln(e)"],
  ["\\log\\left(100\\right)", "log10(100)"],
  ["\\log_{2}\\left(8\\right)", "logb(8,2)"],
  ["\\sqrt{2}", "sqrt(2)"],
  ["\\sqrt[3]{-8}", "surd(-8,3)"],
  ["2\\sqrt{x}", "2*sqrt(x)"],
  ["\\left|x-3\\right|", "abs(x-3)"],
  ["\\binom{5}{2}", "comb(5,2)"],
  ["\\operatorname{solve}\\left(x^2=4,x\\right)", "solve(x^(2)=4,x)"],
  ["\\operatorname{\\mathrm{factor}}\\left(x^2-1\\right)", "factor(x^(2)-1)"],
  // constants and relations
  ["\\exponentialE^{\\imaginaryI\\pi}", "e^(i*pi)"],
  ["\\infty", "inf"],
  ["x\\le 3", "x<=3"],
  ["x\\ne 3", "x!=3"],
  ["a\\coloneq 5", "a:=5"],
  ["a:=5", "a:=5"],
  ["f(x)\\coloneq x^2+1", "f(x):=x^(2)+1"],
  ["\\alpha+\\beta", "alpha+beta"],
  // calculus
  ["\\frac{d}{dx}x^{3}", "diff(x^(3),x)"],
  ["\\frac{\\differentialD}{\\differentialD x}\\left(x^{3}\\right)", "diff((x^(3)),x)"],
  ["\\frac{d^2}{dx^2}x^{3}", "diff(x^(3),x,2)"],
  ["\\int x^{2}\\differentialD x", "int(x^(2),x)"],
  ["\\int_{0}^{1}x^{2}\\,\\mathrm{d}x", "int(x^(2),x,0,1)"],
  ["\\int_{-\\infty}^{\\infty}\\exponentialE^{-x^2}\\differentialD x", "int(e^(-x^(2)),x,-inf,inf)"],
  ["\\sum_{k=1}^{n}k^{2}", "sum(k^(2),k,1,n)"],
  ["\\prod_{k=1}^{5}k", "product(k,k,1,5)"],
  ["\\lim_{x\\to 0}\\frac{\\sin x}{x}", "limit(((sin(x))/(x)),x,0)"],
  // matrices
  ["\\begin{pmatrix}1 & 2\\\\ 3 & 4\\end{pmatrix}", "[[1,2],[3,4]]"],
  ["\\begin{bmatrix}1\\\\2\\\\3\\end{bmatrix}", "[[1],[2],[3]]"],
  ["\\begin{pmatrix}a&b\\\\c&d\\\\\\end{pmatrix}", "[[a,b],[c,d]]"],
  ["\\begin{vmatrix}1&2\\\\3&4\\end{vmatrix}", "det([[1,2],[3,4]])"],
  ["\\operatorname{det}\\left(\\begin{pmatrix}1&2\\\\3&4\\end{pmatrix}\\right)", "det([[1,2],[3,4]])"],
  ["\\det\\left(\\begin{pmatrix}1&2\\\\3&4\\end{pmatrix}\\right)", "det([[1,2],[3,4]])"],
  ["2\\begin{pmatrix}1&2\\end{pmatrix}", "2*[[1,2]]"],
  ["\\begin{pmatrix}1&2\\\\3&4\\end{pmatrix}^{-1}", "[[1,2],[3,4]]^(-1)"],
  ["\\begin{pmatrix}\\frac{1}{2}&x^2\\end{pmatrix}", "[[((1)/(2)),x^(2)]]"],
  ["\\left[1,2,3\\right]", "[1,2,3]"],
];

describe("latexToGiac", () => {
  it.each(cases)("%s -> %s", (latex, giac) => {
    expect(latexToGiac(latex)).toBe(giac);
  });

  const errors: [string, RegExp][] = [
    ["\\placeholder{}+1", /empty boxes/],
    ["\\begin{pmatrix}1&\\\\3&4\\end{pmatrix}", /every cell/],
    ["\\begin{pmatrix}1&2\\\\3\\end{pmatrix}", /same number/],
    ["\\int x^2", /dx/],
    ["\\differentialD x", /d on its own/],
    ["\\mathbb{R}", /Unsupported/],
    ["1&2", /outside a matrix/],
  ];
  it.each(errors)("rejects %s", (latex, message) => {
    expect(() => latexToGiac(latex)).toThrow(UnsupportedLatex);
    expect(() => latexToGiac(latex)).toThrow(message);
  });
});
