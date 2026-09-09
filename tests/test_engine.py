import sympy
from mathnb.engine import Engine


def test_numeric_assignment_and_reference():
    engine = Engine()
    assert engine.evaluate("a:=2") == {"output_latex": "2", "error": None}
    assert engine.evaluate("b:=4") == {"output_latex": "4", "error": None}
    assert engine.evaluate("x:=a+b") == {"output_latex": "6", "error": None}


def test_symbolic_assignment_before_values_are_known():
    engine = Engine()
    result = engine.evaluate("x:=a+b")
    assert result["error"] is None
    assert result["output_latex"] == "a + b"


def test_equation_and_solve():
    engine = Engine()
    result = engine.evaluate("solve(x^2 = 4, x)")
    assert result["error"] is None
    assert result["output_latex"] == sympy.latex([sympy.Integer(-2), sympy.Integer(2)])


def test_matrix_operations():
    engine = Engine()
    engine.evaluate("A:=Matrix([[1,2],[3,4]])")
    result = engine.evaluate("det(A)")
    assert result["error"] is None
    assert result["output_latex"] == sympy.latex(sympy.Integer(-2))


def test_undefined_variable_is_auto_symbol_not_error():
    engine = Engine()
    result = engine.evaluate("y + 1")
    assert result["error"] is None
    assert result["output_latex"] == "y + 1"


def test_bad_syntax_produces_error_not_a_crash():
    engine = Engine()
    result = engine.evaluate("solve(x^2 = , x)")
    assert result["output_latex"] is None
    assert result["error"] is not None


def test_error_in_one_cell_does_not_corrupt_the_namespace():
    engine = Engine()
    engine.evaluate("a:=2")
    engine.evaluate("solve(x^2 = , x)")
    result = engine.evaluate("a")
    assert result == {"output_latex": "2", "error": None}


def test_reset_clears_the_namespace():
    engine = Engine()
    engine.evaluate("a:=2")
    engine.reset()
    result = engine.evaluate("a")
    assert result["error"] is None
    assert result["output_latex"] == "a"
