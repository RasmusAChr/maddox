# tests/test_latex_input.py
import pytest
from mathnb.latex_input import to_engine_text, UnsupportedLatex


@pytest.mark.parametrize("latex, expected", [
    # plain text passes through, whitespace dropped
    ("a:=2", "a:=2"),
    ("solve(x^2 = 4, x)", "solve(x^(2)=4,x)"),
    # spec round-trip examples
    (r"x\coloneq5", "x:=5"),
    (r"\operatorname{solve}\left(2x=4,x\right)", "solve(2x=4,x)"),
    (r"5^{2}", "5^(2)"),
    (r"\frac{x^{2}}{2}+\sqrt{x}", "((x^(2))/(2))+sqrt(x)"),
    (r"\operatorname{Matrix}\left(\left[\left[1,2\right],\left[3,4\right]\right]\right)", "Matrix([[1,2],[3,4]])"),
    (r"\begin{pmatrix}1&2\\3&4\end{pmatrix}", "Matrix([[1,2],[3,4]])"),
    (r"\operatorname{clear}\left(x\right)", "clear(x)"),
    # rule table
    (r"a^b", "a^(b)"),
    (r"x^{10}", "x^(10)"),
    (r"\sqrt[3]{x}", "((x)^(1/(3)))"),
    (r"2\cdot3\times4", "2*3*4"),
    (r"6\div2", "6/2"),
    (r"\pi+\infty", "pi+oo"),
    (r"\exponentialE^{x}", "E^(x)"),
    (r"\imaginaryI^{2}", "I^(2)"),
    (r"\alpha+\beta", "alpha+beta"),
    (r"\lambda", "lamda"),
    (r"x_{1}+x_2", "x_1+x_2"),
    (r"a\le b\ge c\ne d", "a<=b>=c!=d"),
    (r"\mathrm{det}(A)", "det(A)"),
    (r"\text{simplify}(x)", "simplify(x)"),
    (r"\sin(x)+\cos(x)+\ln(x)", "sin(x)+cos(x)+ln(x)"),
    (r"\arcsin(x)", "asin(x)"),
    (r"\begin{bmatrix}a&b\\c&d\end{bmatrix}", "Matrix([[a,b],[c,d]])"),
    (r"\begin{pmatrix}1\\2\end{pmatrix}", "Matrix([[1],[2]])"),
    (r"\left\{x\right\}", "{x}"),
    (r"\left(x\right.", "(x"),
    (r"a\,b\;c\!d\quad e", "abcde"),
    (r"{2}x", "(2)x"),
    (r"x^{}", "x^()"),
])
def test_conversions(latex, expected):
    assert to_engine_text(latex) == expected


def test_unknown_command_is_unsupported():
    with pytest.raises(UnsupportedLatex, match=r"Unsupported notation: \\foo"):
        to_engine_text(r"\foo{x}")


def test_ellipsis_is_unsupported():
    with pytest.raises(UnsupportedLatex, match=r"\\ldots"):
        to_engine_text(r"1,2,\ldots")


def test_placeholder_is_reported_helpfully():
    with pytest.raises(UnsupportedLatex, match="placeholder"):
        to_engine_text(r"\operatorname{solve}\left(\placeholder{}=0,x\right)")


def test_unknown_matrix_environment_is_unsupported():
    with pytest.raises(UnsupportedLatex, match="align"):
        to_engine_text(r"\begin{align}x\end{align}")


def test_stray_closing_brace_is_an_error():
    with pytest.raises(UnsupportedLatex):
        to_engine_text("x}")


def test_complex_subscript_is_unsupported():
    with pytest.raises(UnsupportedLatex, match="subscript"):
        to_engine_text(r"x_{i+1}")
