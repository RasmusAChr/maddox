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
    # beta/gamma/zeta are SymPy functions, Lambda a class, and the "var..."
    # spellings unknown multi-letter names, so they are renamed to plain symbols.
    (r"\alpha+\beta", "alpha+beta_"),
    (r"\gamma\cdot\zeta", "gamma_*zeta_"),
    (r"\Lambda", "Lambda_"),
    (r"\varepsilon+\vartheta+\varphi", "varepsilon_+vartheta_+varphi_"),
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


@pytest.mark.parametrize("latex, expected", [
    # A name juxtaposed with an alphanumeric neighbour must be separated with
    # "*", or SymPy's split_symbols shreds the glued token ("2pir" -> 2*p*i*r).
    (r"2\pi r", "2*pi*r"),
    (r"x\pi", "x*pi"),
    (r"2\pi", "2*pi"),
    (r"\alpha\beta", "alpha*beta_"),
    (r"x\infty", "x*oo"),
    (r"\exponentialE^{\imaginaryI\pi}", "E^(I*pi)"),
    (r"\frac{\pi}{2}x", "((pi)/(2))x"),
    (r"x\sqrt{y}", "x*sqrt(y)"),
    (r"x\sin(x)", "x*sin(x)"),
    (r"2\operatorname{det}(A)", "2*det(A)"),
    # ... but never where a neighbour is punctuation, so calls stay callable.
    (r"\sin(x)", "sin(x)"),
    (r"\sqrt{x}", "sqrt(x)"),
    (r"\operatorname{clear}\left(\alpha\right)", "clear(alpha)"),
    (r"\left(x\right).\operatorname{inv}\left(\right)", "(x).inv()"),
    (r"\pi", "pi"),
    (r"x_\alpha", "x_alpha"),
    # A renamed Greek letter ends in "_", which still counts as part of the name
    # on the left of a boundary but never opens one on the right.
    (r"\beta\gamma", "beta_*gamma_"),
    (r"\beta_{1}", "beta_1"),
    (r"x_1\pi", "x_1*pi"),
])
def test_names_are_separated_from_adjacent_alphanumerics(latex, expected):
    assert to_engine_text(latex) == expected


@pytest.mark.parametrize("latex", [
    r"\log_{2}\left(8\right)",
    r"\log_2(8)",
    r"\sin^{2}(x)",
])
def test_scripted_function_names_are_unsupported(latex):
    with pytest.raises(UnsupportedLatex, match="Unsupported notation"):
        to_engine_text(latex)


@pytest.mark.parametrize("latex", [
    r"\frac{d}{dx}x^{2}",
    r"\frac{\differentialD}{\differentialD x}x",
    r"\frac{dy}{dx}",
])
def test_leibniz_derivative_is_unsupported(latex):
    with pytest.raises(UnsupportedLatex, match="diff"):
        to_engine_text(latex)


def test_a_genuine_d_variable_in_a_fraction_still_converts():
    assert to_engine_text(r"\frac{d}{2}") == "((d)/(2))"
    assert to_engine_text(r"\frac{d}{d}") == "((d)/(d))"


def test_vertical_bar_is_unsupported():
    with pytest.raises(UnsupportedLatex, match="Abs"):
        to_engine_text("|x|")


def test_conversion_never_leaks_the_internal_atom_mark():
    assert "\x00" not in to_engine_text(r"2\pi r\alpha\sin(x)\sqrt{y}")


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
