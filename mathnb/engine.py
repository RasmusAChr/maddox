import ast
import re

import sympy
from sympy.parsing.sympy_parser import (
    parse_expr,
    stringify_expr,
    standard_transformations,
    implicit_multiplication_application,
    convert_xor,
)

from .parser import classify, Assignment

TRANSFORMATIONS = standard_transformations + (
    implicit_multiplication_application,
    convert_xor,
)

_CLEAR = re.compile(r"^clear\((.*)\)$", re.DOTALL)
_IDENTIFIER = re.compile(r"[A-Za-z_][A-Za-z0-9_]*")
_DECIMAL_SIG_FIGS = 6

# Functions whose arguments name the variable to operate on: which argument
# positions (or "rest" for every argument after the expression), and whether a
# list/tuple there names several variables (solve) or only its first element
# does (integrate's (x, a, b) bounds, diff's (x, n)).
_VARIABLE_ARGS = {
    "solve": ([1], True),
    "diff": ("rest", False),
    "Derivative": ("rest", False),
    "integrate": ("rest", False),
    "Integral": ("rest", False),
    "limit": ([1], False),
}


def _build_sympy_globals():
    globals_dict = {}
    exec("from sympy import *", globals_dict)
    return globals_dict


def _decimal_approx_latex(value):
    """"<exact> \\approx <decimal>" latex for an exact, non-integer real
    number; None if `value` isn't one (e.g. it's symbolic, already a float,
    a plain integer, or complex)."""
    if not isinstance(value, sympy.Basic) or isinstance(value, (sympy.Integer, sympy.Float)):
        return None
    if not value.is_number or not value.is_real:
        return None
    try:
        approx = sympy.N(value, _DECIMAL_SIG_FIGS)
    except Exception:
        return None
    return sympy.latex(value) + r" \approx " + sympy.latex(approx)


def _with_decimal_approximations(value, latex):
    """Append a decimal approximation next to any exact, non-integer number
    in `value` -- either the value itself, or (matching solve()'s usual
    return shape) each element of a flat list of numbers."""
    if isinstance(value, list):
        fragments = []
        changed = False
        for element in value:
            frag = _decimal_approx_latex(element)
            fragments.append(frag if frag is not None else sympy.latex(element))
            changed = changed or frag is not None
        return r"\left[ " + ", ".join(fragments) + r"\right]" if changed else latex
    frag = _decimal_approx_latex(value)
    return frag if frag is not None else latex


def _variable_names(arg, all_elements):
    if isinstance(arg, ast.Name):
        return [arg.id]
    if isinstance(arg, (ast.List, ast.Tuple)) and arg.elts:
        elements = arg.elts if all_elements else arg.elts[:1]
        return [e.id for e in elements if isinstance(e, ast.Name)]
    return []


class Engine:
    def __init__(self):
        self._sympy_globals = _build_sympy_globals()
        self.namespace = {}

    def reset(self):
        self.namespace = {}

    def evaluate(self, cell_text):
        cleared = _CLEAR.match(cell_text.strip())
        if cleared:
            return self._clear(cleared.group(1))

        try:
            node = classify(cell_text)
        except Exception as e:
            return {"output_latex": None, "error": str(e)}

        expr_text = node.expr_text if isinstance(node, Assignment) else node.text
        if not expr_text.strip():
            return {"output_latex": None, "error": None}

        error = self._assigned_variable_error(expr_text)
        if error:
            return {"output_latex": None, "error": error}

        try:
            value = parse_expr(
                expr_text,
                local_dict=self.namespace,
                global_dict=self._sympy_globals,
                transformations=TRANSFORMATIONS,
            )
        except Exception as e:
            return {"output_latex": None, "error": f"{type(e).__name__}: {e}"}

        if isinstance(node, Assignment):
            self.namespace[node.name] = value

        try:
            latex = sympy.latex(value)
        except Exception as e:
            return {"output_latex": None, "error": f"Could not render result: {e}"}

        latex = _with_decimal_approximations(value, latex)

        return {"output_latex": latex, "error": None}

    def _clear(self, arg_text):
        names = [n.strip() for n in arg_text.split(",") if n.strip()]
        if not names:
            self.namespace = {}
            return {"output_latex": r"\text{Cleared all variables}", "error": None}
        bad = [n for n in names if not _IDENTIFIER.fullmatch(n)]
        if bad:
            return {"output_latex": None, "error": f"Not a variable name: {bad[0]!r}"}
        for name in names:
            self.namespace.pop(name, None)
        return {"output_latex": r"\text{Cleared } " + ", ".join(names), "error": None}

    def _assigned_variable_error(self, expr_text):
        # stringify_expr applies the same transformations parse_expr would,
        # so implicit multiplication and ^ are already resolved; names bound
        # in the namespace stay bare, unbound ones become Symbol('...') calls.
        try:
            code = stringify_expr(expr_text, self.namespace, self._sympy_globals, TRANSFORMATIONS)
            tree = ast.parse(code, mode="eval")
        except Exception:
            return None  # let parse_expr report the real problem

        for call in ast.walk(tree):
            if not isinstance(call, ast.Call):
                continue
            if isinstance(call.func, ast.Name):
                func_name, offset = call.func.id, 0
            elif isinstance(call.func, ast.Attribute):
                func_name, offset = call.func.attr, 1
            else:
                continue
            spec = _VARIABLE_ARGS.get(func_name)
            if spec is None:
                continue
            positions, all_elements = spec
            if positions == "rest":
                positions = range(1 - offset, len(call.args))
            else:
                positions = [p - offset for p in positions]
            for p in positions:
                if not 0 <= p < len(call.args):
                    continue
                for var in _variable_names(call.args[p], all_elements):
                    value = self.namespace.get(var)
                    if value is not None and not isinstance(value, sympy.Symbol):
                        return (
                            f"{var} currently holds the value {value}, so it can't be "
                            f"used as a variable here. Use another name, or clear it "
                            f"with clear({var})"
                        )
        return None
