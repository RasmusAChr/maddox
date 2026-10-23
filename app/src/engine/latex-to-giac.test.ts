import { describe, expect, it } from "vitest";
import { CALL_OR_PRODUCT, latexToGiac, UnsupportedLatex } from "./latex-to-giac";

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
  // a typed name before "(" is left for the engine to decide (call or product)
  ["f\\left(3\\right)", `f${CALL_OR_PRODUCT}(3)`],
  ["3x\\left(4y+8z\\right)", `3*x${CALL_OR_PRODUCT}(4*y+8*z)`],
  // positions count from 1, as in maths notation
  ["v\\left[1\\right]", "v[0]"],
  ["M\\left[2,1\\right]", "M[1,0]"],
  ["M\\left[1\\right]\\left[2\\right]", "M[0][1]"],
  ["v_2\\left[k+1\\right]", "v_2[(k+1)-1]"],
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
  ["f(x)\\coloneq x^2+1", `f${CALL_OR_PRODUCT}(x):=x^(2)+1`],
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
  // round brackets with a comma are a point, of any length
  ["\\left(1,3\\right)", "ggbvect[1,3]"],
  ["P_1\\coloneq\\left(1,3\\right)", "P_1:=ggbvect[1,3]"],
  ["\\left(1,2,3,4\\right)", "ggbvect[1,2,3,4]"],
  ["(1,3)", "ggbvect[1,3]"],
  ["2\\left(1,3\\right)", "2*ggbvect[1,3]"],
  ["\\left(1,3\\right)\\left(3,8\\right)", "ggbvect[1,3]*ggbvect[3,8]"],
  ["\\left[\\left(1,3\\right),\\left(3,8\\right)\\right]", "[ggbvect[1,3],ggbvect[3,8]]"],
  ["\\left(\\frac{1}{2},x\\right)", "ggbvect[((1)/(2)),x]"],
  // …but not a call's arguments, a function's parameters, or braces
  ["f\\left(1,3\\right)", `f${CALL_OR_PRODUCT}(1,3)`],
  ["\\operatorname{subst}\\left(x,x=2\\right)", "subst(x,x=2)"],
  ["\\left(x,y\\right)\\to x+y", "(x,y)->x+y"],
  ["\\left\\{1,2\\right\\}", "(1,2)"],
  // degrees: ° is a factor the session sets per angle mode
  ["30^{\\circ}", "30*maddox_deg"],
  ["30^\\circ", "30*maddox_deg"],
  ["30\\degree", "30*maddox_deg"],
  ["\\sin\\left(30^{\\circ}\\right)", "sin(30*maddox_deg)"],
  // f′(x): the derivative of f, always a call
  ["f^{\\prime}\\left(x\\right)", "f'(x)"],
  ["f^{\\prime}\\left(2\\right)", "f'(2)"],
  ["f^{\\prime}^{\\prime}\\left(x\\right)", "f''(x)"],
  ["f^{\\prime\\prime}\\left(x\\right)", "f''(x)"],
  ["f^{\\doubleprime}\\left(x\\right)", "f''(x)"],
  ["f'\\left(x\\right)", "f'(x)"],
  ["3f^{\\prime}\\left(x\\right)", "3*f'(x)"],
  ["f^{\\prime}", "f'"],
  // 20% is (20/100), whatever comes before or after it
  ["20\\%", "((20)/100)"],
  ["20\\%\\cdot150", "((20)/100)*150"],
  ["150+20\\%", "150+((20)/100)"],
  ["\\frac{a}{5\\%}", "((a)/(((5)/100)))"],
  ["x^2\\%", "((x^(2))/100)"],
  ["\\left(1+5\\%\\right)^{10}", "(1+((5)/100))^(10)"],
  // piecewise: value & condition per row, optional "if", "otherwise" last
  ["\\begin{cases}-x & x<0\\\\ x^2 & x\\ge0\\end{cases}", "piecewise(x<0,-x,x>=0,x^(2))"],
  ["\\begin{cases}-x & \\text{if } x<0\\\\ x^2 & \\text{otherwise}\\end{cases}", "piecewise(x<0,-x,x^(2))"],
  ["\\begin{cases}1 & x\\le1\\\\ 2 & otherwise\\\\ \\end{cases}", "piecewise(x<=1,1,2)"],
  ["g\\left(x\\right)\\coloneq\\begin{cases}0 & x<0\\\\ x & x\\ge0\\end{cases}", `g${CALL_OR_PRODUCT}(x):=piecewise(x<0,0,x>=0,x)`],
  // units are upright (\mathrm, as unit mode types them); m in italics stays a variable
  ["5\\mathrm{m}", "5*(_m)"],
  ["5m", "5*m"],
  ["72\\,\\mathrm{km/h}", "72*(_km/_h)"],
  ["3\\mathrm{kg}\\cdot9.81\\mathrm{m}/\\mathrm{s}^2", "3*(_kg)*9.81*(_m)/(_s^(2))"],
  // unit mode writes m/s² as \mathrm{m/s}^2; the power belongs to s
  ["9.81\\mathrm{m/s}^2", "9.81*(_m/_s^(2))"],
  ["\\mathrm{m^2}", "(_m^(2))"],
  ["2\\mathrm{in}", "2*(_inch)"],
  ["2\\,\\mathrm{\\Omega}", "2*(_Ohm)"],
  ["\\mathrm{\\mu m}", "(_um)"],
  // → followed only by units converts; (x,y)→x+y stays a function
  ["72\\mathrm{km/h}\\to\\mathrm{m/s}", "convert(72*(_km/_h),(_m/_s))"],
  ["1\\mathrm{kWh}\\to\\mathrm{J}", "convert(1*(_kWh),(_J))"],
  // temperatures: °C and °F are one unit each; → between them is maddox_temp
  ["20\\mathrm{°C}", "20*(_degC)"],
  ["20\\mathrm{^\\circ F}", "20*(_degF)"],
  ["20\\mathrm{°C}\\to\\mathrm{°F}", 'maddox_temp(20,"C","F")'],
  ["300\\mathrm{K}\\to\\mathrm{^{\\circ}C}", 'maddox_temp(300,"K","C")'],
  ["\\left(x,y\\right)\\to x\\mathrm{m}", "(x,y)->x*(_m)"],
  // upright names that are not units: the d of dx, and a call
  ["\\frac{\\mathrm{d}}{\\mathrm{d}x}x^2", "diff(x^(2),x)"],
  ["\\mathrm{transpose}\\left(A\\right)", "transpose(A)"],
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
    ["v\\left[0\\right]", /start at 1/],
    ["2^{\\prime}", /after a function name/],
    ["\\%", /after a number/],
    ["\\begin{cases}1 & otherwise\\\\ 2 & x<0\\end{cases}", /must be the last/],
    ["\\begin{cases}1 & x<0\\\\ 2\\end{cases}", /needs a condition/],
    ["\\begin{cases}1 & otherwise\\end{cases}", /at least one condition/],
  ];
  it.each(errors)("rejects %s", (latex, message) => {
    expect(() => latexToGiac(latex)).toThrow(UnsupportedLatex);
    expect(() => latexToGiac(latex)).toThrow(message);
  });
});
