// Every template: shown in the sidebar and found by the Ctrl+P search.
// `latex` is inserted at the caret; \placeholder{} marks a box to fill in,
// and Tab moves between boxes. MathLive fills `#0` with the selection (or a
// box), and `#@` with the selection or the term just before the caret, so
// typing 2 then choosing Power gives 2^□.

export type Category = { id: string; name: string; icon: string };

export type CatalogItem = {
  label: string;
  /** What it looks like when typed, shown as a hint, e.g. solve(…, x). */
  syntax?: string;
  category: string;
  description: string;
  /** Empty for "Matrix…", which asks for a size first. */
  latex: string;
  /** Extra words the search should match. */
  keywords?: string;
  /** Hidden behind "More" in the sidebar; search always finds it. */
  advanced?: boolean;
};

/** Sidebar order: everyday maths first. */
export const CATEGORIES: Category[] = [
  { id: "basics", name: "Basics", icon: "½" },
  { id: "variables", name: "Variables & functions", icon: "x:=" },
  { id: "solve", name: "Solve", icon: "x=?" },
  { id: "rewrite", name: "Simplify & factor", icon: "( )" },
  { id: "calculus", name: "Calculus", icon: "∫" },
  { id: "matrices", name: "Matrices", icon: "[ ]" },
  { id: "numbers", name: "Numbers & rounding", icon: "≈" },
  { id: "functions", name: "Functions", icon: "f(x)" },
];

const fn = (name: string, args = 1) =>
  `\\operatorname{${name}}\\left(#0${",\\placeholder{}".repeat(args - 1)}\\right)`;

export const CATALOG: CatalogItem[] = [
  // Basics
  { label: "Fraction", syntax: "a/b", category: "basics", description: "Type / for a fraction", latex: "\\frac{#@}{\\placeholder{}}", keywords: "divide" },
  { label: "Power", syntax: "aⁿ", category: "basics", description: "Type ^ for an exponent", latex: "#@^{\\placeholder{}}", keywords: "exponent square" },
  { label: "Square root", syntax: "√a", category: "basics", description: "Type sqrt", latex: "\\sqrt{#0}", keywords: "sqrt radical" },
  { label: "Absolute value", syntax: "|a|", category: "basics", description: "Distance from zero", latex: "\\left|#0\\right|", keywords: "abs" },
  { label: "π", syntax: "pi", category: "basics", description: "Pi, 3.14159…", latex: "\\pi", keywords: "pi constant" },
  { label: "nth root", syntax: "ⁿ√a", category: "basics", description: "Root of any degree", latex: "\\sqrt[\\placeholder{}]{#0}", keywords: "root radical surd cube", advanced: true },
  { label: "e", syntax: "e", category: "basics", description: "Euler's number, 2.71828…", latex: "\\exponentialE", keywords: "euler constant", advanced: true },
  { label: "i", syntax: "i", category: "basics", description: "Imaginary unit, i² = −1", latex: "\\imaginaryI", keywords: "complex imaginary", advanced: true },
  { label: "Percent", syntax: "20%", category: "basics", description: "Hundredths: 20% is 0.2", latex: "#@\\%", keywords: "percent procent hundredths", advanced: true },
  { label: "∞", syntax: "oo", category: "basics", description: "Infinity", latex: "\\infty", keywords: "infinity", advanced: true },

  // Variables & functions
  { label: "Assign a variable", syntax: "a := 5", category: "variables", description: "Store a value under a name", latex: "\\placeholder{}\\coloneq #0", keywords: "define store set" },
  { label: "Define a function", syntax: "f(x) := …", category: "variables", description: "Then use it like f(3)", latex: "f\\left(x\\right)\\coloneq #0", keywords: "define" },
  { label: "Piecewise function", syntax: "{ … if …", category: "variables", description: "One case per row: value, then condition; otherwise for the rest", latex: "\\begin{cases}#0 & \\placeholder{}\\\\ \\placeholder{} & \\placeholder{}\\end{cases}", keywords: "piecewise cases if otherwise condition branch" },
  { label: "Forget a variable", syntax: "purge(a)", category: "variables", description: "Remove one stored value", latex: fn("purge"), keywords: "clear delete delvar purge", advanced: true },
  { label: "Forget all variables", syntax: "restart", category: "variables", description: "Clear every variable and function", latex: "\\operatorname{restart}", keywords: "clear all reset restart", advanced: true },

  // Solve
  { label: "Solve an equation", syntax: "solve(…, x)", category: "solve", description: "Exact solutions for x", latex: "\\operatorname{solve}\\left(#0,x\\right)", keywords: "equation root zero" },
  { label: "Solve a system", syntax: "solve([…, …], [x, y])", category: "solve", description: "Several equations at once", latex: "\\operatorname{solve}\\left(\\left[#0,\\placeholder{}\\right],\\left[x,y\\right]\\right)", keywords: "linear system simultaneous equations" },
  { label: "Solve numerically", syntax: "fsolve(…, x)", category: "solve", description: "Decimal solutions when exact ones fail", latex: "\\operatorname{fsolve}\\left(#0,x\\right)", keywords: "numeric nsolve fsolve", advanced: true },
  { label: "Solve with complex numbers", syntax: "csolve(…, x)", category: "solve", description: "Include complex solutions", latex: "\\operatorname{csolve}\\left(#0,x\\right)", keywords: "complex csolve", advanced: true },

  // Simplify & factor
  { label: "Simplify", syntax: "simplify(…)", category: "rewrite", description: "Shortest form", latex: fn("simplify") },
  { label: "Expand", syntax: "expand(…)", category: "rewrite", description: "Multiply out brackets", latex: fn("expand"), keywords: "multiply out" },
  { label: "Factor", syntax: "factor(…)", category: "rewrite", description: "Write as a product", latex: fn("factor"), keywords: "factorise factorize" },
  { label: "Substitute", syntax: "subst(…, x=2)", category: "rewrite", description: "Put a value in for a variable", latex: "\\operatorname{subst}\\left(#0,x=\\placeholder{}\\right)", keywords: "replace with evaluate at subst" },
  { label: "Partial fractions", syntax: "partfrac(…, x)", category: "rewrite", description: "Split a fraction into simple parts", latex: "\\operatorname{partfrac}\\left(#0,x\\right)", keywords: "partfrac", advanced: true },

  // Calculus
  { label: "Derivative", syntax: "d/dx", category: "calculus", description: "Differentiate with respect to x", latex: "\\frac{\\differentialD}{\\differentialD x}\\left(#0\\right)", keywords: "diff differentiate slope" },
  { label: "Integral", syntax: "∫ … dx", category: "calculus", description: "Antiderivative", latex: "\\int #0\\,\\differentialD x", keywords: "integrate antiderivative indefinite" },
  { label: "Definite integral", syntax: "∫ₐᵇ … dx", category: "calculus", description: "Integral from a to b (area)", latex: "\\int_{\\placeholder{}}^{\\placeholder{}}#0\\,\\differentialD x", keywords: "integrate area" },
  { label: "Limit", syntax: "lim x→a", category: "calculus", description: "Value approached as x → a", latex: "\\lim_{x\\to\\placeholder{}}#0", keywords: "lim approach" },
  { label: "Sum", syntax: "Σ", category: "calculus", description: "Sum from k = 1 to n", latex: "\\sum_{k=1}^{\\placeholder{}}#0", keywords: "sigma series", advanced: true },
  { label: "Product", syntax: "Π", category: "calculus", description: "Product from k = 1 to n", latex: "\\prod_{k=1}^{\\placeholder{}}#0", keywords: "pi product", advanced: true },
  { label: "Derivative of a function", syntax: "f′(x)", category: "calculus", description: "Type ' after a function's name; f″ for the second", latex: "f^{\\prime}\\left(#0\\right)", keywords: "prime derivative f' dash" },
  { label: "Derivative (as a function)", syntax: "diff(…, x)", category: "calculus", description: "Same as d/dx, written as a command", latex: "\\operatorname{diff}\\left(#0,x\\right)", keywords: "diff derivative", advanced: true },
  { label: "Taylor series", syntax: "taylor(…, x=0, 5)", category: "calculus", description: "Polynomial approximation around a point", latex: "\\operatorname{taylor}\\left(#0,x=0,5\\right)", keywords: "series taylor maclaurin", advanced: true },
  { label: "Differential equation", syntax: "desolve(…, x, y)", category: "calculus", description: "Solve an ODE for y(x)", latex: "\\operatorname{desolve}\\left(#0,x,y\\right)", keywords: "ode desolve", advanced: true },

  // Matrices
  { label: "Matrix…", syntax: "Ctrl+M", category: "matrices", description: "Choose a size, then fill it in", latex: "", keywords: "matrix vector new" },
  { label: "Determinant", syntax: "det(…)", category: "matrices", description: "det(A)", latex: fn("det"), keywords: "det" },
  { label: "Inverse", syntax: "A⁻¹", category: "matrices", description: "Inverse matrix", latex: "#@^{-1}", keywords: "inv inverse" },
  { label: "Transpose", syntax: "transpose(…)", category: "matrices", description: "Swap rows and columns", latex: fn("transpose"), keywords: "transpose" },
  { label: "Eigenvalues", syntax: "eigenvals(…)", category: "matrices", description: "λ with Av = λv", latex: fn("eigenvals"), keywords: "eigenvalues eigenvals" },
  { label: "Eigenvectors", syntax: "eigenvects(…)", category: "matrices", description: "Eigenvectors as columns", latex: fn("eigenvects"), keywords: "eigenvectors eigenvects", advanced: true },
  { label: "Reduced row echelon form", syntax: "rref(…)", category: "matrices", description: "Gauss–Jordan elimination", latex: fn("rref"), keywords: "rref gauss elimination", advanced: true },
  { label: "Rank", syntax: "rank(…)", category: "matrices", description: "Number of independent rows", latex: fn("rank"), advanced: true },
  { label: "Null space", syntax: "ker(…)", category: "matrices", description: "Kernel: solutions of Ax = 0", latex: fn("ker"), keywords: "kernel ker", advanced: true },
  { label: "Identity matrix", syntax: "idn(n)", category: "matrices", description: "n×n identity", latex: fn("idn"), keywords: "identity idn", advanced: true },
  { label: "Dot product", syntax: "dot(u, v)", category: "matrices", description: "Scalar product of two vectors", latex: fn("dot", 2), keywords: "scalar dot", advanced: true },
  { label: "Cross product", syntax: "cross(u, v)", category: "matrices", description: "Vector product of two 3D vectors", latex: fn("cross", 2), keywords: "vector cross", advanced: true },

  // Numbers & rounding
  { label: "Decimal value", syntax: "approx(…)", category: "numbers", description: "As a decimal number", latex: fn("approx"), keywords: "evalf numeric decimal approx" },
  { label: "Decimal digits", syntax: "approx(…, 10)", category: "numbers", description: "Decimal with n significant digits", latex: "\\operatorname{approx}\\left(#0,10\\right)", keywords: "evalf digits precision" },
  { label: "Round", syntax: "round(…)", category: "numbers", description: "To the nearest whole number", latex: fn("round") },
  { label: "Round down", syntax: "floor(…)", category: "numbers", description: "Largest whole number below", latex: fn("floor"), keywords: "floor", advanced: true },
  { label: "Round up", syntax: "ceil(…)", category: "numbers", description: "Smallest whole number above", latex: fn("ceil"), keywords: "ceil ceiling", advanced: true },
  { label: "Factorial", syntax: "n!", category: "numbers", description: "1·2·…·n", latex: "#@!", advanced: true },
  { label: "Binomial coefficient", syntax: "(n k)", category: "numbers", description: "n choose k", latex: "\\binom{#@}{\\placeholder{}}", keywords: "comb ncr choose", advanced: true },
  { label: "Greatest common divisor", syntax: "gcd(a, b)", category: "numbers", description: "gcd", latex: fn("gcd", 2), keywords: "gcd", advanced: true },
  { label: "Least common multiple", syntax: "lcm(a, b)", category: "numbers", description: "lcm", latex: fn("lcm", 2), keywords: "lcm", advanced: true },
  { label: "Remainder", syntax: "irem(a, b)", category: "numbers", description: "Remainder of a ÷ b", latex: fn("irem", 2), keywords: "mod modulo irem", advanced: true },
  { label: "Prime factors", syntax: "ifactor(n)", category: "numbers", description: "Factor an integer into primes", latex: fn("ifactor"), keywords: "prime ifactor", advanced: true },
  { label: "Is it prime?", syntax: "isprime(n)", category: "numbers", description: "True or false", latex: fn("isprime"), keywords: "isprime prime", advanced: true },

  // Functions
  { label: "sin", syntax: "sin(…)", category: "functions", description: "Sine (radians)", latex: "\\sin\\left(#0\\right)", keywords: "trig sine" },
  { label: "cos", syntax: "cos(…)", category: "functions", description: "Cosine (radians)", latex: "\\cos\\left(#0\\right)", keywords: "trig cosine" },
  { label: "tan", syntax: "tan(…)", category: "functions", description: "Tangent (radians)", latex: "\\tan\\left(#0\\right)", keywords: "trig tangent" },
  { label: "ln", syntax: "ln(…)", category: "functions", description: "Natural logarithm", latex: "\\ln\\left(#0\\right)", keywords: "log natural" },
  { label: "log", syntax: "log(…)", category: "functions", description: "Logarithm base 10", latex: "\\log\\left(#0\\right)", keywords: "log10" },
  { label: "Exponential", syntax: "eˣ", category: "functions", description: "e to the power x", latex: "\\exponentialE^{#0}", keywords: "exp", advanced: true },
  { label: "Logarithm, any base", syntax: "log_b(…)", category: "functions", description: "Choose the base", latex: "\\log_{\\placeholder{}}\\left(#0\\right)", keywords: "log base logb", advanced: true },
  { label: "arcsin", syntax: "arcsin(…)", category: "functions", description: "Inverse sine", latex: "\\arcsin\\left(#0\\right)", keywords: "asin trig inverse", advanced: true },
  { label: "arccos", syntax: "arccos(…)", category: "functions", description: "Inverse cosine", latex: "\\arccos\\left(#0\\right)", keywords: "acos trig inverse", advanced: true },
  { label: "arctan", syntax: "arctan(…)", category: "functions", description: "Inverse tangent", latex: "\\arctan\\left(#0\\right)", keywords: "atan trig inverse", advanced: true },
];

/** Command names that turn upright while typing, e.g. "solve" becomes solve. */
export const OPERATOR_NAMES = [
  ...new Set(CATALOG.flatMap((c) => [...c.latex.matchAll(/\\operatorname\{([a-z]+)\}/g)].map((m) => m[1]))),
];
