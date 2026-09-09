import sympy
from sympy.parsing.sympy_parser import (
    parse_expr,
    standard_transformations,
    implicit_multiplication_application,
    convert_xor,
)

from .parser import classify, Assignment

TRANSFORMATIONS = standard_transformations + (
    implicit_multiplication_application,
    convert_xor,
)


def _build_sympy_globals():
    globals_dict = {}
    exec("from sympy import *", globals_dict)
    return globals_dict


class Engine:
    def __init__(self):
        self._sympy_globals = _build_sympy_globals()
        self.namespace = {}

    def reset(self):
        self.namespace = {}

    def evaluate(self, cell_text):
        try:
            node = classify(cell_text)
        except Exception as e:
            return {"output_latex": None, "error": str(e)}

        expr_text = node.expr_text if isinstance(node, Assignment) else node.text
        if not expr_text.strip():
            return {"output_latex": None, "error": "Empty expression"}

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

        return {"output_latex": latex, "error": None}
