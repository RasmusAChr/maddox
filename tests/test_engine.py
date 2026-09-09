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


def test_empty_cell_is_a_no_op():
    engine = Engine()
    engine.evaluate("a:=2")
    assert engine.evaluate("") == {"output_latex": None, "error": None}
    assert engine.evaluate("   ") == {"output_latex": None, "error": None}
    assert engine.evaluate("a") == {"output_latex": "2", "error": None}


def test_clear_unassigns_a_variable():
    engine = Engine()
    engine.evaluate("a:=2")
    result = engine.evaluate("clear(a)")
    assert result["error"] is None
    assert engine.evaluate("a") == {"output_latex": "a", "error": None}


def test_clear_several_and_clear_all():
    engine = Engine()
    engine.evaluate("a:=1")
    engine.evaluate("b:=2")
    engine.evaluate("c:=3")
    assert engine.evaluate("clear(a, b)")["error"] is None
    assert engine.evaluate("a + b + c")["output_latex"] == "a + b + 3"
    assert engine.evaluate("clear()")["error"] is None
    assert engine.evaluate("c")["output_latex"] == "c"


def test_clear_unknown_name_is_harmless():
    engine = Engine()
    assert engine.evaluate("clear(nothing)")["error"] is None


def test_solving_for_an_assigned_variable_is_an_error():
    engine = Engine()
    engine.evaluate("x:=5")
    result = engine.evaluate("solve(2x = 4, x)")
    assert result["output_latex"] is None
    assert "x" in result["error"] and "5" in result["error"] and "clear(x)" in result["error"]


def test_solving_for_a_free_variable_still_works_when_others_are_assigned():
    engine = Engine()
    engine.evaluate("x:=5")
    result = engine.evaluate("solve(2y = 4, y)")
    assert result["error"] is None
    assert result["output_latex"] == sympy.latex([sympy.Integer(2)])


def test_diff_integrate_limit_with_assigned_variable_are_errors():
    engine = Engine()
    engine.evaluate("x:=5")
    for text in ["diff(x^2, x)", "integrate(x^2, x)", "integrate(x^2, (x, 0, 1))", "limit(x, x, 0)"]:
        result = engine.evaluate(text)
        assert result["error"] is not None, text
        assert "clear(x)" in result["error"], text


def test_unbalanced_brackets_produce_error_not_a_crash():
    engine = Engine()
    result = engine.evaluate("))")
    assert result["output_latex"] is None
    assert result["error"] is not None
