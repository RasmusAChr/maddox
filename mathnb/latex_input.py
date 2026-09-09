"""Convert the LaTeX a MathLive math-field produces into the engine's text syntax."""
import re


class UnsupportedLatex(ValueError):
    pass


# Marks both ends of every *name* this converter emits (pi, oo, alpha, sin,
# sqrt, Matrix, \operatorname{...} bodies). _resolve_atom_marks turns a mark
# into "*" when it sits between two alphanumerics and drops it otherwise, so a
# juxtaposed name is never glued to its neighbour. Without it SymPy's
# split_symbols transformation silently tears the glued token apart:
# "2\pi r" -> "2pir" -> 2*p*i*r, "x\sqrt{y}" -> "xsqrt(y)" -> q*r*s*t*x*y.
# Marks never survive to_engine_text's return value.
_ATOM = "\x00"


def _atom(text):
    return _ATOM + text + _ATOM if text else text


def _resolve_atom_marks(text):
    text = re.sub(_ATOM + "+", _ATOM, text)
    out = []
    for i, ch in enumerate(text):
        if ch != _ATOM:
            out.append(ch)
            continue
        # "_" ends a name (the Greek renames below) but never starts one -- on
        # the right it opens a subscript, which needs no "*".
        left = out[-1] if out else ""
        right = text[i + 1:i + 2]
        if (left.isalnum() or left == "_") and right.isalnum():
            out.append("*")
    return "".join(out)


_GREEK = {
    "alpha", "beta", "gamma", "delta", "epsilon", "varepsilon", "zeta", "eta",
    "theta", "vartheta", "iota", "kappa", "lambda", "mu", "nu", "xi", "omicron",
    "pi", "rho", "sigma", "tau", "upsilon", "phi", "varphi", "chi", "psi", "omega",
    "Gamma", "Delta", "Theta", "Lambda", "Xi", "Pi", "Sigma", "Upsilon", "Phi",
    "Psi", "Omega",
}
# Greek names SymPy does not treat as a plain symbol: "lambda" is a Python
# keyword, "beta"/"gamma"/"zeta" are SymPy functions, "Lambda" is a class, and
# the "var..." spellings are unknown multi-letter names that split_symbols
# would shred. The trailing "_" spellings are plain Symbols and still render as
# the Greek letter (sympy.latex gives e.g. "\beta_{}").
_GREEK_RENAMES = {
    "lambda": "lamda",
    "beta": "beta_", "gamma": "gamma_", "zeta": "zeta_", "Lambda": "Lambda_",
    "varepsilon": "varepsilon_", "vartheta": "vartheta_", "varphi": "varphi_",
}

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

# _SIMPLE entries that stand for a symbol (rather than an operator) and so need
# the atom marks; the rest ("*", "<=", ...) never touch a neighbouring name.
_SYMBOL_COMMANDS = {"pi", "infty", "exponentialE", "imaginaryI", "differentialD"}

_TOKEN = re.compile(r"\\([A-Za-z]+)|\\(.)|(\s+)|(.)", re.DOTALL)
_SUBSCRIPT = re.compile(r"[A-Za-z0-9]+")

# Leibniz notation: \frac{d}{dx}, \frac{dy}{dx}, \frac{\differentialD}{\differentialD x}.
# The engine has no d/dx operator, so "((d)/(dx))" would quietly evaluate to a
# ratio of plain symbols instead of a derivative.
_DIFF_NUMERATOR = re.compile(r"d([A-Za-z(].*)?$", re.DOTALL)
_DIFF_DENOMINATOR = re.compile(r"d[A-Za-z]")


def _is_leibniz_derivative(numerator, denominator):
    numerator = numerator.replace(_ATOM, "")
    denominator = denominator.replace(_ATOM, "")
    return bool(_DIFF_NUMERATOR.match(numerator)
                and _DIFF_DENOMINATOR.match(denominator))


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
            if val == "|":
                raise UnsupportedLatex("Use Abs(x) for absolute value")
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
        inner = self.arg().replace(_ATOM, "")
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
            if _is_leibniz_derivative(a, b):
                raise UnsupportedLatex("Use diff(expr, x) for derivatives")
            return f"(({a})/({b}))"
        if name == "sqrt":
            if self.peek() == ("char", "["):
                self.i += 1
                n = self.convert_until(stop=(("char", "]"),))
                self.expect(("char", "]"))
                return f"(({self.arg()})^(1/({n})))"
            return _ATOM + f"sqrt({self.arg()})"
        if name in _TEXT_LIKE:
            return _atom(self.raw_group())
        if name == "placeholder":
            self.raw_group()
            raise UnsupportedLatex("Fill in all placeholder fields first")
        if name == "begin":
            return self.matrix(self.raw_group())
        if name == "end":
            raise UnsupportedLatex("Unexpected \\end")
        if name in _SIMPLE:
            text = _SIMPLE[name]
            return _atom(text) if name in _SYMBOL_COMMANDS else text
        if name in _FUNCTIONS:
            script = self.peek()
            if script in (("char", "_"), ("char", "^")):
                call = _FUNCTION_RENAMES.get(name, name)
                hint = (f"use {call}(x, 2)" if script[1] == "_"
                        else f"use ({call}(x))^2")
                raise UnsupportedLatex(
                    f"Unsupported notation: \\{name}{script[1]}... - {hint}"
                )
            return _atom(_FUNCTION_RENAMES.get(name, name))
        if name in _GREEK:
            text = _GREEK_RENAMES.get(name, name)
            # A subscript already makes the name a plain symbol, so the "_"
            # suffix is redundant there and would render as a superscript.
            if text.endswith("_") and self.peek() == ("char", "_"):
                text = text[:-1]
            return _atom(text)
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
        return _ATOM + "Matrix([" + ",".join("[" + ",".join(r) + "]" for r in rows) + "])"


def to_engine_text(latex):
    return _resolve_atom_marks(_Converter(_tokenize(latex)).convert_until())
