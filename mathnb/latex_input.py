"""Convert the LaTeX a MathLive math-field produces into the engine's text syntax."""
import re


class UnsupportedLatex(ValueError):
    pass


_GREEK = {
    "alpha", "beta", "gamma", "delta", "epsilon", "varepsilon", "zeta", "eta",
    "theta", "vartheta", "iota", "kappa", "lambda", "mu", "nu", "xi", "omicron",
    "pi", "rho", "sigma", "tau", "upsilon", "phi", "varphi", "chi", "psi", "omega",
    "Gamma", "Delta", "Theta", "Lambda", "Xi", "Pi", "Sigma", "Upsilon", "Phi",
    "Psi", "Omega",
}
# "lambda" is a Python keyword; SymPy spells the symbol "lamda".
_GREEK_RENAMES = {"lambda": "lamda"}

_FUNCTIONS = {
    "sin", "cos", "tan", "cot", "sec", "csc", "arcsin", "arccos", "arctan",
    "sinh", "cosh", "tanh", "exp", "ln", "log", "min", "max", "det", "lim",
}
_FUNCTION_RENAMES = {"arcsin": "asin", "arccos": "acos", "arctan": "atan"}

_SIMPLE = {
    "cdot": "*", "times": "*", "div": "/",
    "pi": "pi", "infty": "oo",
    "exponentialE": "E", "imaginaryI": "I", "differentialD": "d",
    "le": "<=", "leq": "<=", "ge": ">=", "geq": ">=", "ne": "!=", "neq": "!=",
    "coloneq": ":=", "coloneqq": ":=",
    "lbrace": "{", "rbrace": "}", "lbrack": "[", "rbrack": "]",
    "lparen": "(", "rparen": ")",
    "{": "{", "}": "}", "%": "%",
}
_SPACING = {",", ";", "!", " ", "quad", "qquad", "enspace", "thinspace",
            "medspace", "thickspace", "negthinspace"}
_TEXT_LIKE = {"operatorname", "mathrm", "text", "mathit", "mathbf", "textrm", "mathsf"}
_MATRIX_ENVS = {"pmatrix", "bmatrix", "matrix", "vmatrix", "Bmatrix"}

_TOKEN = re.compile(r"\\([A-Za-z]+)|\\(.)|(\s+)|(.)", re.DOTALL)
_SUBSCRIPT = re.compile(r"[A-Za-z0-9]+")


def _tokenize(latex):
    tokens = []
    for m in _TOKEN.finditer(latex):
        name, sym, space, char = m.groups()
        if name is not None:
            tokens.append(("cmd", name))
        elif sym is not None:
            tokens.append(("cmd", sym))
        elif space is not None:
            continue
        else:
            tokens.append(("char", char))
    return tokens


class _Converter:
    def __init__(self, tokens):
        self.tokens = tokens
        self.i = 0

    def peek(self):
        return self.tokens[self.i] if self.i < len(self.tokens) else None

    def expect(self, token):
        if self.peek() != token:
            raise UnsupportedLatex(f"Expected {token[1]!r}")
        self.i += 1

    def convert_until(self, stop=()):
        out = []
        while self.i < len(self.tokens) and self.tokens[self.i] not in stop:
            out.append(self.item())
        return "".join(out)

    def item(self):
        kind, val = self.tokens[self.i]
        self.i += 1
        if kind == "char":
            if val == "{":
                inner = self.group_body()
                return f"({inner})" if inner else ""
            if val == "}":
                raise UnsupportedLatex("Unexpected '}'")
            if val == "^":
                return "^(" + self.arg() + ")"
            if val == "_":
                return "_" + self.subscript()
            if val == "&":
                raise UnsupportedLatex("Unexpected '&' outside a matrix")
            return val
        return self.command(val)

    def group_body(self):
        inner = self.convert_until(stop=(("char", "}"),))
        self.expect(("char", "}"))
        return inner

    def arg(self):
        if self.peek() == ("char", "{"):
            self.i += 1
            return self.group_body()
        if self.peek() is None:
            raise UnsupportedLatex("Missing argument")
        return self.item()

    def subscript(self):
        inner = self.arg()
        if not _SUBSCRIPT.fullmatch(inner):
            raise UnsupportedLatex(f"Unsupported subscript: {inner}")
        return inner

    def raw_group(self):
        self.expect(("char", "{"))
        depth, parts = 1, []
        while self.i < len(self.tokens):
            kind, val = self.tokens[self.i]
            self.i += 1
            if (kind, val) == ("char", "{"):
                depth += 1
            elif (kind, val) == ("char", "}"):
                depth -= 1
                if depth == 0:
                    return "".join(parts)
            parts.append(val)
        raise UnsupportedLatex("Unterminated group")

    def command(self, name):
        if name in _SPACING:
            return ""
        if name in ("left", "right", "mleft", "mright"):
            if self.peek() == ("char", "."):
                self.i += 1
            return ""
        if name == "frac":
            a, b = self.arg(), self.arg()
            return f"(({a})/({b}))"
        if name == "sqrt":
            if self.peek() == ("char", "["):
                self.i += 1
                n = self.convert_until(stop=(("char", "]"),))
                self.expect(("char", "]"))
                return f"(({self.arg()})^(1/({n})))"
            return f"sqrt({self.arg()})"
        if name in _TEXT_LIKE:
            return self.raw_group()
        if name == "placeholder":
            self.raw_group()
            raise UnsupportedLatex("Fill in all placeholder fields first")
        if name == "begin":
            return self.matrix(self.raw_group())
        if name == "end":
            raise UnsupportedLatex("Unexpected \\end")
        if name in _SIMPLE:
            return _SIMPLE[name]
        if name in _FUNCTIONS:
            return _FUNCTION_RENAMES.get(name, name)
        if name in _GREEK:
            return _GREEK_RENAMES.get(name, name)
        raise UnsupportedLatex(f"Unsupported notation: \\{name}")

    def matrix(self, env):
        if env not in _MATRIX_ENVS:
            raise UnsupportedLatex(f"Unsupported notation: \\begin{{{env}}}")
        rows, cell = [[]], []
        while True:
            tok = self.peek()
            if tok is None:
                raise UnsupportedLatex("Unterminated matrix")
            if tok == ("cmd", "end"):
                self.i += 1
                if self.raw_group() != env:
                    raise UnsupportedLatex("Mismatched \\end")
                break
            if tok == ("char", "&"):
                self.i += 1
                rows[-1].append("".join(cell))
                cell = []
                continue
            if tok == ("cmd", "\\"):
                self.i += 1
                rows[-1].append("".join(cell))
                cell = []
                rows.append([])
                continue
            cell.append(self.item())
        rows[-1].append("".join(cell))
        if rows[-1] == [""]:
            rows.pop()
        return "Matrix([" + ",".join("[" + ",".join(r) + "]" for r in rows) + "])"


def to_engine_text(latex):
    return _Converter(_tokenize(latex)).convert_until()
