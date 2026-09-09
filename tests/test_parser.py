import pytest
from mathnb.parser import classify, Assignment, Expression


def test_simple_numeric_assignment():
    node = classify("a:=2")
    assert isinstance(node, Assignment)
    assert node.name == "a"
    assert node.expr_text == "2"


def test_symbolic_assignment():
    node = classify("x:=a+b")
    assert isinstance(node, Assignment)
    assert node.name == "x"
    assert node.expr_text == "a+b"


def test_plain_expression_with_no_equals_is_untouched():
    node = classify("2+2")
    assert isinstance(node, Expression)
    assert node.text == "2+2"


def test_bare_equation_is_wrapped_in_eq():
    node = classify("x^2 = 4")
    assert isinstance(node, Expression)
    assert node.text == "Eq(x^2, 4)"


def test_equation_nested_in_function_call_is_wrapped():
    node = classify("solve(x^2 = 4, x)")
    assert isinstance(node, Expression)
    assert node.text == "solve(Eq(x^2, 4), x)"


def test_comparison_operators_are_left_untouched():
    assert classify("x <= 4").text == "x <= 4"
    assert classify("x >= 4").text == "x >= 4"
    assert classify("x != 4").text == "x != 4"
    assert classify("x == 4").text == "x == 4"


def test_invalid_assignment_target_raises():
    with pytest.raises(ValueError):
        classify("2x := 4")


def test_multiple_bare_equations_are_each_wrapped():
    node = classify("solve([x = 1, y = 2], [x, y])")
    assert node.text == "solve([Eq(x, 1), Eq(y, 2)], [x, y])"
