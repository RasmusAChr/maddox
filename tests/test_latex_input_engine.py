# tests/test_latex_input_engine.py
"""End-to-end: MathLive LaTeX -> to_engine_text -> Engine.evaluate.

The unit tests in test_latex_input.py pin the engine *text*; these pin what
SymPy actually makes of that text. They are the regression net for the class of
bug where a conversion looks plausible but evaluates to something else --
"2\\pi r" -> "2pir", which SymPy's split_symbols silently reads as 2*p*i*r.
"""
import json
import pathlib
import re

import pytest
import sympy

from mathnb.engine import Engine
from mathnb.latex_input import to_engine_text, UnsupportedLatex

x, y, r = sympy.symbols("x y r")

MATRIX = r"\begin{pmatrix}1&2\\3&4\end{pmatrix}"


def run(latex):
    return Engine().evaluate(to_engine_text(latex))


@pytest.mark.parametrize("latex, expected", [
    (r"2\pi r", 2 * sympy.pi * r),
    (r"\frac{\pi}{2}x", sympy.pi * x / 2),
    (r"x\infty", sympy.oo * x),
    (r"\exponentialE^{\imaginaryI\pi}", sympy.Integer(-1)),
    (r"\imaginaryI^{2}", sympy.Integer(-1)),
    (r"\sqrt{x^{2}}", sympy.sqrt(x ** 2)),
    (r"\sqrt[3]{x}", x ** sympy.Rational(1, 3)),
    (r"\frac{x^{2}}{2}+\sqrt{x}", x ** 2 / 2 + sympy.sqrt(x)),
    (r"x\sqrt{y}", x * sympy.sqrt(y)),
    (r"x\sin\left(x\right)", x * sympy.sin(x)),
    (r"\operatorname{solve}\left(2x=4,x\right)", [sympy.Integer(2)]),
    (r"\operatorname{diff}\left(x^{2},x\right)", 2 * x),
    (r"\operatorname{integrate}\left(x,\left(x,0,1\right)\right)", sympy.Rational(1, 2)),
    (MATRIX, sympy.Matrix([[1, 2], [3, 4]])),
    (r"\operatorname{det}\left(" + MATRIX + r"\right)", sympy.Integer(-2)),
    (r"2\operatorname{det}\left(" + MATRIX + r"\right)", sympy.Integer(-4)),
])
def test_latex_evaluates_to_the_expected_value(latex, expected):
    result = run(latex)
    assert result["error"] is None
    assert result["output_latex"] == sympy.latex(expected)


@pytest.mark.parametrize("latex, fragments", [
    # Greek letters must survive as single symbols, not as products of letters.
    (r"\alpha+\beta", [r"\alpha", r"\beta"]),
    (r"\gamma\cdot\zeta", [r"\gamma", r"\zeta"]),
    (r"\beta\gamma", [r"\beta", r"\gamma"]),
    (r"\beta_{1}+\beta_{2}", [r"\beta_{1}", r"\beta_{2}"]),
    (r"\lambda+\Lambda", [r"\lambda", r"\Lambda"]),
    (r"\varepsilon+\vartheta+\varphi", [r"\varepsilon", r"\vartheta", r"\varphi"]),
    (r"x\infty", [r"\infty", "x"]),
    (r"\operatorname{N}\left(\pi,5\right)", ["3.1416"]),
])
def test_latex_evaluates_without_error_and_renders_the_right_names(latex, fragments):
    result = run(latex)
    assert result["error"] is None
    for fragment in fragments:
        assert fragment in result["output_latex"]


JS_PATH = pathlib.Path(__file__).resolve().parent.parent / "frontend" / "notebook.js"


def _templates():
    """The TEMPLATES table straight out of notebook.js, so the two cannot drift."""
    js = JS_PATH.read_text(encoding="utf-8")
    entries = re.findall(r'label: "([^"]*)".*?latex: "((?:[^"\\]|\\.)*)"', js)
    return [(label, json.loads('"' + latex + '"')) for label, latex in entries]


# Four templates need a matrix, not a scalar, in their placeholder; the rest
# take any expression. A leading space keeps "\coloneq x" a separate token.
_PLACEHOLDER_FILL = {
    "Determinant": MATRIX,
    "Inverse": MATRIX,
    "Transpose": MATRIX,
    "Eigenvalues": MATRIX,
}


def test_every_template_is_found():
    assert len(_templates()) == 23


@pytest.mark.parametrize("label, latex", _templates(), ids=lambda v: v if isinstance(v, str) else "")
def test_every_template_evaluates_without_error(label, latex):
    filled = latex.replace(r"\placeholder{}", _PLACEHOLDER_FILL.get(label, " x"))
    result = run(filled)
    assert result["error"] is None, f"{label}: {result['error']}"
    assert result["output_latex"] is not None


@pytest.mark.parametrize("latex", [
    r"\log_{2}\left(8\right)",   # would become log_2(8) == 8*log_2
    r"\sin^{2}\left(x\right)",
    r"\frac{d}{dx}x^{2}",        # would become ((d)/(dx))x^2 == x
    r"\frac{\differentialD}{\differentialD x}x",
    r"\left|x\right|",
])
def test_notation_the_engine_cannot_express_is_rejected(latex):
    with pytest.raises(UnsupportedLatex):
        to_engine_text(latex)
