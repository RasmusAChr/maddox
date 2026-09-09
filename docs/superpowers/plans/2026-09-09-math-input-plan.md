# 2D Math Input Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace each cell's CodeMirror text editor with a MathLive 2D math field, converting its LaTeX to the engine's existing text syntax on the backend, so input looks and behaves like math (raised exponents, fractions, placeholder boxes) while evaluation is unchanged.

**Architecture:** The frontend owns `<math-field>` elements and sends their LaTeX to `Api`. A new pure module `mathnb/latex_input.py` converts LaTeX to engine text (rule table in the spec) and raises `UnsupportedLatex` for anything outside it. `Api` converts, stores both `latex` and `input` on each cell, and calls the untouched `Engine`.

**Tech Stack:** Python 3.11+, SymPy, pywebview, pytest; MathLive 0.110.0 (vendored, `mathlive.min.js` + `fonts/`), KaTeX (already vendored) for output.

**Spec:** `docs/superpowers/specs/2026-09-09-math-input-design.md`

## Global Constraints

- The engine (`mathnb/engine.py`) is not modified; all existing engine tests keep passing unchanged.
- The converter handles exactly the spec's rule table; any other LaTeX command raises `UnsupportedLatex("Unsupported notation: \\name")` — never a silent guess.
- Keyboard behaviour is preserved one-for-one: Enter = new cell below; Ctrl+Enter = run cell; Ctrl+Shift+Enter = run all; Backspace on an empty cell = remove it unless it is the only cell; Up/Down = previous/next cell only when the caret cannot move within the expression.
- Notebook files: cells gain a `latex` key; `input` remains engine text. v1 files (no `latex`) must still open and run.
- No network access at runtime: MathLive script and fonts are vendored under `frontend/vendor/mathlive/`; sounds are disabled.
- No automated frontend tests (project convention); frontend tasks are verified with `evaluate_js` probes against the running app and DPI-aware screenshots (see the probe harness in Task 4).
- Work happens on branch `worktree-math-input` in the worktree `C:\Users\rasmu\Downloads\maddox\.claude\worktrees\math-input`; run Python via its `.venv/Scripts/python.exe` / `.venv/Scripts/pytest.exe`.

---

### Task 1: Vendor MathLive and prove it loads offline

**Files:**
- Create: `frontend/vendor/mathlive/mathlive.min.js`, `frontend/vendor/mathlive/fonts/*.woff2` (20 files)
- Modify: `frontend/index.html`
- Create (temporary, deleted at end of task): `probe_mathlive.py`

**Interfaces:**
- Produces: a page where `customElements.get("math-field")` is defined and `MathfieldElement.fontsDirectory` points at the vendored fonts. Later tasks assume the global `MathfieldElement` exists after `customElements.whenDefined("math-field")`.

- [ ] **Step 1: Download MathLive 0.110.0 assets**

From the worktree root:

```bash
mkdir -p frontend/vendor/mathlive/fonts
curl -sL -o frontend/vendor/mathlive/mathlive.min.js https://cdn.jsdelivr.net/npm/mathlive@0.110.0/mathlive.min.js
for f in KaTeX_AMS-Regular KaTeX_Caligraphic-Bold KaTeX_Caligraphic-Regular KaTeX_Fraktur-Bold KaTeX_Fraktur-Regular KaTeX_Main-Bold KaTeX_Main-BoldItalic KaTeX_Main-Italic KaTeX_Main-Regular KaTeX_Math-BoldItalic KaTeX_Math-Italic KaTeX_SansSerif-Bold KaTeX_SansSerif-Italic KaTeX_SansSerif-Regular KaTeX_Script-Regular KaTeX_Size1-Regular KaTeX_Size2-Regular KaTeX_Size3-Regular KaTeX_Size4-Regular KaTeX_Typewriter-Regular; do
  curl -sL -o "frontend/vendor/mathlive/fonts/$f.woff2" "https://cdn.jsdelivr.net/npm/mathlive@0.110.0/fonts/$f.woff2"
done
ls -la frontend/vendor/mathlive frontend/vendor/mathlive/fonts | head -40
```

Expected: `mathlive.min.js` is several hundred KB; each font file is 4–70 KB (none are 0 bytes or HTML error pages — check with `head -c 100 frontend/vendor/mathlive/mathlive.min.js`).

- [ ] **Step 2: Load it in `frontend/index.html`**

Add after the KaTeX script tag and before `notebook.js`:

```html
  <script src="vendor/mathlive/mathlive.min.js"></script>
```

(Keep the CodeMirror tags for now; Task 6 removes them.)

- [ ] **Step 3: Write the probe**

`probe_mathlive.py` (temporary):

```python
import json
import time
import webview


def on_loaded(window):
    time.sleep(0.5)
    result = window.evaluate_js("""
    (function() {
      return JSON.stringify({
        defined: !!customElements.get('math-field'),
        globalName: typeof MathfieldElement !== 'undefined' ? 'MathfieldElement'
                  : (typeof MathLive !== 'undefined' ? 'MathLive' : 'none'),
      });
    })();
    """)
    with open("probe_result.json", "w", encoding="utf-8") as f:
        f.write(result if isinstance(result, str) else json.dumps(result))
    print("PROBE DONE", flush=True)


def main():
    window = webview.create_window("Math Notebook", "frontend/index.html", width=900, height=700)
    window.events.loaded += lambda: on_loaded(window)
    webview.start()


if __name__ == "__main__":
    main()
```

- [ ] **Step 4: Run the probe**

```bash
rm -f probe_result.json; (./.venv/Scripts/python.exe -u probe_mathlive.py > /tmp/probe.log 2>&1 &); sleep 6; cat /tmp/probe.log; cat probe_result.json
for pid in $(wmic process where "name='python.exe' and commandline like '%probe_mathlive.py%'" get ProcessId 2>/dev/null | tr -d '\r' | grep -E '^[0-9]+'); do taskkill //PID $pid //F >/dev/null 2>&1; done; true
```

Expected: `{"defined": true, "globalName": "MathfieldElement"}`. If `globalName` is `"MathLive"`, record that in your report — Task 4 then uses `MathLive.MathfieldElement`. If `defined` is false, the script did not load: check the file is real JS (Step 1) and the path in `index.html`.

- [ ] **Step 5: Remove the probe files and commit**

```bash
rm -f probe_mathlive.py probe_result.json
git add frontend/vendor/mathlive frontend/index.html
git commit -m "Vendor MathLive 0.110.0 for offline 2D math input"
```

---

### Task 2: LaTeX → engine text converter

**Files:**
- Create: `mathnb/latex_input.py`
- Test: `tests/test_latex_input.py`

**Interfaces:**
- Produces: `to_engine_text(latex: str) -> str` and `class UnsupportedLatex(ValueError)`. No SymPy dependency. Whitespace-insensitive; output contains no spaces except inside `\text{}`-style groups.

- [ ] **Step 1: Write the failing tests**

```python
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
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
./.venv/Scripts/pytest.exe tests/test_latex_input.py -q
```

Expected: FAIL with `ModuleNotFoundError: No module named 'mathnb.latex_input'`.

- [ ] **Step 3: Implement `mathnb/latex_input.py`**

```python
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
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
./.venv/Scripts/pytest.exe tests/test_latex_input.py -q
```

Expected: all pass. If a parametrized case fails, fix the converter — do not change the expected strings, they come from the spec.

- [ ] **Step 5: Commit**

```bash
git add mathnb/latex_input.py tests/test_latex_input.py
git commit -m "Add LaTeX-to-engine-text converter"
```

---

### Task 3: Api and Notebook carry LaTeX

**Files:**
- Modify: `mathnb/api.py`
- Modify: `mathnb/notebook.py`
- Modify: `tests/test_api.py`, `tests/test_notebook.py`

**Interfaces:**
- Consumes: `to_engine_text`, `UnsupportedLatex` (Task 2); `Engine` unchanged.
- Produces: cell dicts of shape `{"latex": str | None, "input": str, "output_latex": str | None, "error": str | None}`.
  - `Api.evaluate_cell(index, latex)` — converts, evaluates, stores. On `UnsupportedLatex`: stores `input=""`, `error=str(e)`, engine not called.
  - `Api.set_cell_texts(latexes)` — stores `latex` and converted `input` (`""` if unsupported; the error surfaces on the next run) for every index; pads/truncates as before.
  - `Api.run_all()` — for each cell: if `latex` is not `None`, reconvert it (so an unsupported cell reports its error), else use `input` (v1 cell).
  - `Notebook.add_cell(input_text="", output_latex=None, error=None, latex=None)`.

- [ ] **Step 1: Update the tests**

In `tests/test_notebook.py`, change the two exact-shape assertions:

```python
def test_save_writes_expected_json_shape(tmp_path):
    nb = Notebook()
    nb.add_cell(input_text="x:=1", output_latex="1", error=None)
    path = tmp_path / "test.mnb"
    nb.save(str(path))

    with open(path) as f:
        data = json.load(f)

    assert data == {
        "cells": [{"input": "x:=1", "output_latex": "1", "error": None, "latex": None}]
    }


def test_add_cell_returns_the_new_cell():
    nb = Notebook()
    cell = nb.add_cell(input_text="a:=2", latex="a\\coloneq2")
    assert cell == {"input": "a:=2", "output_latex": None, "error": None, "latex": "a\\coloneq2"}
    assert nb.cells == [cell]
```

In `tests/test_api.py`, update the existing tests whose assertions include full cell dicts, and add new ones. Replace these functions wholesale:

```python
def test_evaluate_cell_appends_a_new_cell():
    api = Api()
    cell = api.evaluate_cell(None, "a:=2")
    assert cell == {"latex": "a:=2", "input": "a:=2", "output_latex": "2", "error": None}
    assert api.notebook.cells == [cell]


def test_set_cell_texts_updates_existing_and_appends_new_cells():
    api = Api()
    api.evaluate_cell(None, "a:=2")
    cells = api.set_cell_texts(["a:=3", "b:=4"])
    assert cells[0]["latex"] == "a:=3"
    assert cells[0]["input"] == "a:=3"
    assert cells[0]["output_latex"] == "2"  # cached output kept until re-run
    assert cells[1] == {"latex": "b:=4", "input": "b:=4", "output_latex": None, "error": None}
```

(Keep every other existing test as is; they only inspect `input`/`output_latex`/`error`, which are unchanged.) Then append:

```python
def test_evaluate_cell_converts_latex_and_stores_both_forms():
    api = Api()
    cell = api.evaluate_cell(None, r"x\coloneq5^{2}")
    assert cell["latex"] == r"x\coloneq5^{2}"
    assert cell["input"] == "x:=5^(2)"
    assert cell["output_latex"] == "25"
    assert cell["error"] is None


def test_unsupported_latex_is_a_cell_error_and_skips_the_engine():
    api = Api()
    api.evaluate_cell(None, "a:=1")
    cell = api.evaluate_cell(None, r"a+\foo")
    assert cell["output_latex"] is None
    assert "Unsupported notation" in cell["error"]
    assert cell["input"] == ""
    assert api.evaluate_cell(0, "a")["output_latex"] == "1"


def test_run_all_reconverts_latex_and_reports_unsupported_cells():
    api = Api()
    api.set_cell_texts([r"a\coloneq2", r"\foo", "a"])
    results = api.run_all()
    assert results[0]["output_latex"] == "2"
    assert "Unsupported notation" in results[1]["error"]
    assert results[2]["output_latex"] == "2"


def test_v1_cells_without_latex_still_run(tmp_path):
    path = tmp_path / "old.mnb"
    path.write_text('{"cells": [{"input": "a:=2", "output_latex": null, "error": null}]}')
    api = Api()
    api.load_notebook(str(path))
    results = api.run_all()
    assert results[0]["output_latex"] == "2"
    assert results[0]["latex"] is None
```

- [ ] **Step 2: Run tests to verify the new/changed ones fail**

```bash
./.venv/Scripts/pytest.exe tests/test_api.py tests/test_notebook.py -q
```

Expected: the updated shape tests and the four new tests FAIL (missing `latex` key / `add_cell` rejects `latex=`); everything else passes.

- [ ] **Step 3: Update `mathnb/notebook.py`**

```python
    def add_cell(self, input_text="", output_latex=None, error=None, latex=None):
        cell = {"input": input_text, "output_latex": output_latex, "error": error, "latex": latex}
        self.cells.append(cell)
        return cell
```

- [ ] **Step 4: Update `mathnb/api.py`**

Replace the import block and the three methods; leave `new_notebook`, `save_notebook`, `load_notebook` untouched.

```python
import webview

from .engine import Engine
from .latex_input import to_engine_text, UnsupportedLatex
from .notebook import Notebook


class Api:
    def __init__(self):
        self.engine = Engine()
        self.notebook = Notebook()
        self.current_path = None

    def _run(self, latex, text):
        if latex is not None:
            try:
                text = to_engine_text(latex)
            except UnsupportedLatex as e:
                return {"latex": latex, "input": "", "output_latex": None, "error": str(e)}
        result = self.engine.evaluate(text)
        return {"latex": latex, "input": text,
                "output_latex": result["output_latex"], "error": result["error"]}

    def evaluate_cell(self, index, latex):
        cell = self._run(latex, "")
        if index is None or index >= len(self.notebook.cells):
            self.notebook.cells.append(cell)
        else:
            self.notebook.cells[index] = cell
        return cell

    def set_cell_texts(self, latexes):
        cells = self.notebook.cells
        for i, latex in enumerate(latexes):
            try:
                text = to_engine_text(latex)
            except UnsupportedLatex:
                text = ""
            if i < len(cells):
                cells[i]["latex"] = latex
                cells[i]["input"] = text
            else:
                cells.append({"latex": latex, "input": text, "output_latex": None, "error": None})
        del cells[len(latexes):]
        return cells

    def run_all(self):
        self.engine.reset()
        for i, cell in enumerate(self.notebook.cells):
            self.notebook.cells[i] = self._run(cell.get("latex"), cell["input"])
        return self.notebook.cells
```

- [ ] **Step 5: Run the full suite**

```bash
./.venv/Scripts/pytest.exe -q
```

Expected: all pass (engine tests untouched and green).

- [ ] **Step 6: Commit**

```bash
git add mathnb/api.py mathnb/notebook.py tests/test_api.py tests/test_notebook.py
git commit -m "Api converts cell LaTeX to engine text; cells store both forms"
```

---

### Task 4: Swap CodeMirror for math-field (editor, keymap, sync)

**Files:**
- Modify: `frontend/notebook.js`
- Modify: `frontend/style.css`
- Create (temporary): `probe_cells.py`

**Interfaces:**
- Consumes: `Api.evaluate_cell(index, latex)`, `set_cell_texts(latexes)`, `run_all()` (Task 3); cells may carry `latex: null` (v1 files).
- Produces: `cellEditors` holds `<math-field>` elements; helper `cellLatex(mf)`; keymap per the spec. Templates keep working temporarily through `insertTemplate` (rewritten in Task 5).

- [ ] **Step 1: Replace the editor code in `frontend/notebook.js`**

Replace `buildCellDom`, `makeExtraKeys`, `focusEditor`, `focusEnd`, `moveToNextCell`, `moveToPrevCell`, `cellWrapper`, `reindexCell`, `createCellElement`, `insertCellAfter`, `removeCell`, `runCell`, `syncTexts`, `insertTemplate` and the `pywebviewready` listener with the following. Leave `TEMPLATES`, `renderOutput`, `clearCells`, `renderCells`, `newNotebook`, `openNotebook`, `setStatus`, `saveNotebook`, `runAll`, `renderTemplates` as they are (they only rely on the helpers below by name).

```javascript
const ENGINE_FUNCTIONS = [
  "solve", "simplify", "expand", "factor", "subs", "diff", "integrate",
  "limit", "Matrix", "det", "inv", "eigenvals", "N", "clear", "sqrt",
];

function buildCellDom() {
  const wrapper = document.createElement("div");
  wrapper.className = "cell";

  const actions = document.createElement("div");
  actions.className = "cell-actions";
  wrapper.appendChild(actions);

  const main = document.createElement("div");
  main.className = "cell-main";
  wrapper.appendChild(main);

  const mf = document.createElement("math-field");
  mf.className = "cell-input";
  main.appendChild(mf);

  const outputDiv = document.createElement("div");
  outputDiv.className = "output";
  main.appendChild(outputDiv);

  const runBtn = document.createElement("button");
  runBtn.className = "run-btn";
  runBtn.title = "Run cell (Ctrl+Enter)";
  runBtn.setAttribute("aria-label", "Run cell");
  runBtn.innerHTML =
    '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">' +
    '<path d="M7 4.5v15l12-7.5z" fill="none" stroke="currentColor" ' +
    'stroke-width="1.8" stroke-linejoin="round"/></svg>';
  actions.appendChild(runBtn);

  return { wrapper, mf, outputDiv, runBtn };
}

function configureMathField(mf) {
  const shortcuts = { ...mf.inlineShortcuts, ":=": "\\coloneq" };
  ENGINE_FUNCTIONS.forEach((name) => {
    shortcuts[name] = `\\operatorname{${name}}`;
  });
  mf.inlineShortcuts = shortcuts;
  mf.smartFence = true;
}

function cellLatex(mf) {
  return mf.value;
}

// getIndex() returns this cell's current index; it is re-bound whenever
// cells are inserted or removed (see reindexCell).
function bindCellKeys(mf, getIndex) {
  mf.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      e.stopPropagation();
      if (e.ctrlKey) runCell(getIndex());
      else insertCellAfter(getIndex());
    } else if (e.key === "Backspace" && cellLatex(mf) === "") {
      e.preventDefault();
      if (cellEditors.length > 1) removeCell(getIndex());
    }
  });
  mf.addEventListener("move-out", (e) => {
    if (e.detail.direction === "upward") {
      e.preventDefault();
      moveToPrevCell(getIndex());
    } else if (e.detail.direction === "downward") {
      e.preventDefault();
      moveToNextCell(getIndex());
    }
  });
}

function focusStart(mf) {
  mf.focus();
  mf.executeCommand("moveToMathfieldStart");
}

function focusEnd(mf) {
  mf.focus();
  mf.executeCommand("moveToMathfieldEnd");
}

function moveToNextCell(index) {
  if (index + 1 < cellEditors.length) focusStart(cellEditors[index + 1]);
}

function moveToPrevCell(index) {
  if (index > 0) focusEnd(cellEditors[index - 1]);
}

function cellWrapper(mf) {
  return mf.closest(".cell");
}

function reindexCell(j) {
  const mf = cellEditors[j];
  const wrapper = cellWrapper(mf);
  wrapper.dataset.index = j;
  wrapper.querySelector(".run-btn").onclick = () => runCell(j);
  mf._getIndex = () => j;
}

// Creates a cell at `index`, shifting any later cells down by one.
function createCellElement(cell, index) {
  const { wrapper, mf, outputDiv } = buildCellDom();

  const container = document.getElementById("cells");
  const next = cellEditors[index] ? cellWrapper(cellEditors[index]) : null;
  container.insertBefore(wrapper, next);

  configureMathField(mf);
  if (cell.latex) {
    mf.value = cell.latex;
  } else if (cell.input) {
    mf.setValue(cell.input, { format: "ascii-math" });
  }

  cellEditors.splice(index, 0, mf);
  mf._getIndex = () => index;
  for (let j = index; j < cellEditors.length; j++) reindexCell(j);
  bindCellKeys(mf, () => mf._getIndex());
  mf.addEventListener("focus", () => { activeEditor = mf; });

  renderOutput(outputDiv, cell);
  return mf;
}

function insertCellAfter(index) {
  const mf = createCellElement({ latex: "", input: "", output_latex: null, error: null }, index + 1);
  syncTexts();
  focusStart(mf);
}

function removeCell(index) {
  const mf = cellEditors[index];
  cellWrapper(mf).remove();
  cellEditors.splice(index, 1);
  if (activeEditor === mf) activeEditor = null;
  for (let j = index; j < cellEditors.length; j++) reindexCell(j);
  syncTexts();
  if (index > 0) {
    moveToPrevCell(index);
  } else {
    focusStart(cellEditors[0]);
  }
}

async function runCell(index) {
  const latex = cellLatex(cellEditors[index]);
  const cell = await window.pywebview.api.evaluate_cell(index, latex);
  const wrapper = document.querySelector(`.cell[data-index="${index}"]`);
  renderOutput(wrapper.querySelector(".output"), cell);
}

function syncTexts() {
  return window.pywebview.api.set_cell_texts(cellEditors.map(cellLatex));
}

function insertTemplate(snippet) {
  const mf = activeEditor || cellEditors[0];
  if (!mf) return;
  mf.insert(snippet.replace("|", ""), { focus: true });
}

async function setupMathLive() {
  await customElements.whenDefined("math-field");
  MathfieldElement.fontsDirectory = "vendor/mathlive/fonts";
  MathfieldElement.soundsDirectory = null;
}

window.addEventListener("pywebviewready", async () => {
  if (!customElements.get("math-field")) {
    document.getElementById("cells").textContent =
      "Math input failed to load: vendor/mathlive/mathlive.min.js is missing.";
    return;
  }
  await setupMathLive();
  renderTemplates();
  document.getElementById("new-btn").onclick = newNotebook;
  document.getElementById("open-btn").onclick = openNotebook;
  document.getElementById("save-btn").onclick = saveNotebook;
  document.getElementById("run-all-btn").onclick = runAll;
  document.addEventListener("keydown", (e) => {
    if (e.ctrlKey && e.shiftKey && e.key === "Enter") {
      e.preventDefault();
      runAll();
    }
  });
  renderCells([]);
});
```

Notes for the implementer:
- Task 1 reported the global name; if it was `MathLive`, use `MathLive.MathfieldElement` in `setupMathLive`.
- The `keydown` listener is on the host element; MathLive's own handling runs first. If the probe in Step 3 shows Enter also inserting something or Ctrl+Enter not reaching the handler, switch Enter handling to the documented `beforeinput` route (`ev.inputType === "insertLineBreak"`) and Ctrl+Enter to a `keybindings` entry — and record what you did in the report.
- `renderCells` calls `createCellElement(cell, i)` with v1 cells that have `input` but no `latex`; the `ascii-math` import path above covers that.

- [ ] **Step 2: Style the math field in `frontend/style.css`**

Replace the `.CodeMirror` block with:

```css
math-field.cell-input {
  display: block;
  width: 100%;
  border: 1px solid var(--border-soft);
  border-radius: 4px;
  padding: 4px 8px;
  font-size: 16px;
  background: var(--surface);
}

math-field.cell-input:focus-within {
  outline: 2px solid var(--accent);
  outline-offset: -1px;
}
```

- [ ] **Step 3: Write the probe harness (reused by Tasks 5 and 6)**

`probe_cells.py` (temporary; keep until Task 6 deletes it):

```python
import json
import sys
import time
import webview
from mathnb.api import Api

api = Api()


def on_loaded(window):
    js = window.evaluate_js
    r = {}
    js("cellEditors[0].value = 'a\\\\coloneq5^{2}';")
    r["latex"] = js("cellEditors[0].value")
    js("runCell(0);")
    time.sleep(1.5)
    r["output"] = js("document.querySelector('.cell .output').textContent")
    r["backendInput"] = api.notebook.cells[0]["input"]
    # Enter -> new cell below, focused
    js("cellEditors[0].dispatchEvent(new KeyboardEvent('keydown', {key: 'Enter', bubbles: true}));")
    time.sleep(0.3)
    r["afterEnter"] = {"count": js("cellEditors.length"),
                       "cell1HasFocus": js("document.activeElement === cellEditors[1]")}
    # Backspace on the (empty) new cell removes it
    js("cellEditors[1].dispatchEvent(new KeyboardEvent('keydown', {key: 'Backspace', bubbles: true}));")
    time.sleep(0.3)
    r["afterBackspace"] = js("cellEditors.length")
    # Backspace on the only cell (emptied) is a no-op
    js("cellEditors[0].value = ''; cellEditors[0].dispatchEvent(new KeyboardEvent('keydown', {key: 'Backspace', bubbles: true}));")
    r["onlyCellKept"] = js("cellEditors.length")
    # Ctrl+Enter runs
    js("cellEditors[0].value = '2+2'; cellEditors[0].dispatchEvent(new KeyboardEvent('keydown', {key: 'Enter', ctrlKey: true, bubbles: true}));")
    time.sleep(1.5)
    r["ctrlEnterOutput"] = js("document.querySelector('.cell .output').textContent")
    # move-out downward from cell 0 with a cell below
    js("insertCellAfter(0); cellEditors[0].dispatchEvent(new CustomEvent('move-out', {detail: {direction: 'downward'}, cancelable: true}));")
    time.sleep(0.3)
    r["moveOutFocusesCell1"] = js("document.activeElement === cellEditors[1]")
    with open("probe_result.json", "w", encoding="utf-8") as f:
        json.dump(r, f, indent=2)
    print("PROBE DONE", flush=True)


def main():
    window = webview.create_window("Math Notebook", "frontend/index.html", js_api=api, width=1000, height=700)
    window.events.loaded += lambda: on_loaded(window)
    webview.start()


if __name__ == "__main__":
    main()
```

- [ ] **Step 4: Run the probe**

```bash
rm -f probe_result.json; (./.venv/Scripts/python.exe -u probe_cells.py > /tmp/probe.log 2>&1 &); sleep 9; cat /tmp/probe.log; cat probe_result.json
for pid in $(wmic process where "name='python.exe' and commandline like '%probe_cells.py%'" get ProcessId 2>/dev/null | tr -d '\r' | grep -E '^[0-9]+'); do taskkill //PID $pid //F >/dev/null 2>&1; done; true
```

Expected (all must hold; fix the JS until they do):
- `latex` is `a\coloneq5^{2}`; `backendInput` is `a:=5^(2)`; `output` contains `25`
- `afterEnter.count` 2 and `cell1HasFocus` true; `afterBackspace` 1; `onlyCellKept` 1
- `ctrlEnterOutput` contains `4`
- `moveOutFocusesCell1` true

Note `document.activeElement` for a focused math-field is the `<math-field>` host element itself (focus is delegated into its shadow root). If the focus checks come back false while everything else works, check `document.activeElement.tagName` and adjust the probe, not the app.

- [ ] **Step 5: Take a DPI-aware screenshot and look at it**

Run the app (`./.venv/Scripts/python.exe app.py &`), then in PowerShell (this is the same capture used throughout the project; `SetProcessDPIAware` is essential — without it the capture is cropped and content appears missing):

```powershell
Add-Type @"
using System; using System.Runtime.InteropServices;
public class Dpi { [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
 [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
 public struct RECT { public int Left; public int Top; public int Right; public int Bottom; } }
"@
[Dpi]::SetProcessDPIAware() | Out-Null; Add-Type -AssemblyName System.Drawing
$p = Get-Process | Where-Object { $_.MainWindowTitle -eq "Math Notebook" } | Select-Object -First 1
$r = New-Object Dpi+RECT; [Dpi]::GetWindowRect($p.MainWindowHandle, [ref]$r) | Out-Null
$b = New-Object System.Drawing.Bitmap ($r.Right-$r.Left), ($r.Bottom-$r.Top)
[System.Drawing.Graphics]::FromImage($b).CopyFromScreen($r.Left, $r.Top, 0, 0, $b.Size); $b.Save("$PWD\shot.png")
```

Type `5^2` in the cell by hand is not possible for an agent; instead set `cellEditors[0].value = '5^{2}+\\frac{1}{2}'` via a probe before capturing. Open `shot.png` with the Read tool and confirm the exponent is raised and the fraction is stacked (not `5^2` as text). Close the app afterwards (`taskkill` on its PID). Delete `shot.png`.

- [ ] **Step 6: Commit**

```bash
git add frontend/notebook.js frontend/style.css
git commit -m "Replace CodeMirror cell editor with MathLive math-field"
```

---

### Task 5: Templates with placeholder fields

**Files:**
- Modify: `frontend/notebook.js` (`TEMPLATES`, `insertTemplate`, `renderTemplates`)

**Interfaces:**
- Consumes: `activeEditor`, `cellEditors`, `mf.insert` (Task 4).
- Produces: `TEMPLATES[*].items[*]` gain a `latex` field; `insertTemplate(item)` inserts LaTeX with `\placeholder{}` fields; selected content fills the first placeholder.

- [ ] **Step 1: Rewrite the template data**

Replace `TEMPLATES` with:

```javascript
// `hint` is shown in the sidebar; `latex` is what gets inserted. `\placeholder{}`
// is a fillable box; Tab moves between them.
const TEMPLATES = [
  { category: "Assign", items: [
    { label: "Assign variable", hint: "x := …", latex: "x\\coloneq\\placeholder{}" },
    { label: "Clear variable", hint: "clear(…)", latex: "\\operatorname{clear}\\left(\\placeholder{}\\right)" },
    { label: "Clear all variables", hint: "clear()", latex: "\\operatorname{clear}\\left(\\right)" },
  ]},
  { category: "Algebra", items: [
    { label: "Solve equation", hint: "solve(… = 0, x)", latex: "\\operatorname{solve}\\left(\\placeholder{}=0,x\\right)" },
    { label: "Simplify", hint: "simplify(…)", latex: "\\operatorname{simplify}\\left(\\placeholder{}\\right)" },
    { label: "Expand", hint: "expand(…)", latex: "\\operatorname{expand}\\left(\\placeholder{}\\right)" },
    { label: "Factor", hint: "factor(…)", latex: "\\operatorname{factor}\\left(\\placeholder{}\\right)" },
    { label: "Substitute", hint: "(…).subs(x, 2)", latex: "\\left(\\placeholder{}\\right).\\operatorname{subs}\\left(x,2\\right)" },
    { label: "Fraction", hint: "a/b", latex: "\\frac{\\placeholder{}}{\\placeholder{}}" },
    { label: "Square root", hint: "sqrt(…)", latex: "\\sqrt{\\placeholder{}}" },
    { label: "Power", hint: "…^n", latex: "\\placeholder{}^{\\placeholder{}}" },
  ]},
  { category: "Calculus", items: [
    { label: "Derivative", hint: "diff(…, x)", latex: "\\operatorname{diff}\\left(\\placeholder{},x\\right)" },
    { label: "Integral", hint: "integrate(…, x)", latex: "\\operatorname{integrate}\\left(\\placeholder{},x\\right)" },
    { label: "Definite integral", hint: "integrate(…, (x, 0, 1))", latex: "\\operatorname{integrate}\\left(\\placeholder{},\\left(x,0,1\\right)\\right)" },
    { label: "Limit", hint: "limit(…, x, 0)", latex: "\\operatorname{limit}\\left(\\placeholder{},x,0\\right)" },
  ]},
  { category: "Linear algebra", items: [
    { label: "Matrix 2×2", hint: "Matrix([[a, b], [c, d]])", latex: "\\begin{pmatrix}\\placeholder{}&\\placeholder{}\\\\\\placeholder{}&\\placeholder{}\\end{pmatrix}" },
    { label: "Determinant", hint: "det(…)", latex: "\\operatorname{det}\\left(\\placeholder{}\\right)" },
    { label: "Inverse", hint: "(…).inv()", latex: "\\left(\\placeholder{}\\right).\\operatorname{inv}\\left(\\right)" },
    { label: "Transpose", hint: "(…).T", latex: "\\left(\\placeholder{}\\right).T" },
    { label: "Eigenvalues", hint: "(…).eigenvals()", latex: "\\left(\\placeholder{}\\right).\\operatorname{eigenvals}\\left(\\right)" },
    { label: "Linear system", hint: "solve([… = 0, y = 0], [x, y])", latex: "\\operatorname{solve}\\left(\\left[\\placeholder{}=0,y=0\\right],\\left[x,y\\right]\\right)" },
  ]},
  { category: "Numeric", items: [
    { label: "Evaluate", hint: "N(…)", latex: "\\operatorname{N}\\left(\\placeholder{}\\right)" },
    { label: "Evaluate to 10 digits", hint: "N(…, 10)", latex: "\\operatorname{N}\\left(\\placeholder{},10\\right)" },
  ]},
];
```

- [ ] **Step 2: Rewrite `insertTemplate` and `renderTemplates`**

```javascript
function insertTemplate(item) {
  const mf = activeEditor || cellEditors[0];
  if (!mf) return;
  const selected = mf.getValue(mf.selection, "latex");
  const latex = selected
    ? item.latex.replace("\\placeholder{}", selected)
    : item.latex;
  mf.insert(latex, { focus: true, selectionMode: "placeholder" });
}

function renderTemplates() {
  const container = document.getElementById("templates");
  TEMPLATES.forEach((group, i) => {
    const details = document.createElement("details");
    details.open = i === 0 || i === 1;
    const summary = document.createElement("summary");
    summary.textContent = group.category;
    details.appendChild(summary);

    const list = document.createElement("div");
    list.className = "template-list";
    group.items.forEach((item) => {
      const btn = document.createElement("button");
      btn.title = item.hint;
      btn.onclick = () => insertTemplate(item);
      const label = document.createElement("span");
      label.textContent = item.label;
      const code = document.createElement("code");
      code.textContent = item.hint;
      btn.appendChild(label);
      btn.appendChild(code);
      list.appendChild(btn);
    });
    details.appendChild(list);
    container.appendChild(details);
  });
}
```

`selectionMode: "placeholder"` asks MathLive to select the first placeholder after insertion so typing fills it; if the installed version ignores the option, follow the insert with `mf.executeCommand("moveToNextPlaceholder")` and note it in the report.

- [ ] **Step 3: Extend the probe and run it**

Append to `probe_cells.py`'s `on_loaded`, before the file is written:

```python
    js("renderCells([]); cellEditors[0].value = 'x^2-4'; cellEditors[0].focus(); cellEditors[0].executeCommand('selectAll');")
    js("Array.from(document.querySelectorAll('#templates button')).find(b => b.textContent.startsWith('Solve equation')).click();")
    time.sleep(0.3)
    r["templateWrapsSelection"] = js("cellEditors[0].value")
    js("insertCellAfter(0); Array.from(document.querySelectorAll('#templates button')).find(b => b.textContent.startsWith('Derivative')).click();")
    time.sleep(0.3)
    r["templateWithPlaceholder"] = js("cellEditors[1].value")
    js("runCell(1);")
    time.sleep(1.5)
    r["placeholderRunError"] = js("document.querySelectorAll('.cell .output')[1].textContent")
```

Run the probe as in Task 4 Step 4. Expected:
- `templateWrapsSelection` is `\operatorname{solve}\left(x^2-4=0,x\right)` (MathLive may normalise, e.g. `x^{2}`; what matters is the selection replaced the placeholder and no `\placeholder` remains)
- `templateWithPlaceholder` contains `\operatorname{diff}` and `\placeholder`
- `placeholderRunError` contains `placeholder` (the converter's "Fill in all placeholder fields first")

- [ ] **Step 4: Commit**

```bash
git add frontend/notebook.js
git commit -m "Templates insert LaTeX with placeholder fields"
```

---

### Task 6: Remove CodeMirror, final verification

**Files:**
- Delete: `frontend/vendor/codemirror.min.js`, `frontend/vendor/codemirror.min.css`, `frontend/vendor/python.min.js`
- Modify: `frontend/index.html`
- Delete: `probe_cells.py`, `probe_result.json`

- [ ] **Step 1: Remove CodeMirror**

```bash
git rm -q frontend/vendor/codemirror.min.js frontend/vendor/codemirror.min.css frontend/vendor/python.min.js
```

Remove the two CodeMirror `<link>`/`<script>` tags and the python-mode script tag from `frontend/index.html`. `grep -rn -i codemirror frontend/*.html frontend/*.js frontend/*.css` must return nothing.

- [ ] **Step 2: Full backend suite**

```bash
./.venv/Scripts/pytest.exe -q
```

Expected: all pass.

- [ ] **Step 3: Re-run the probe from Task 4/5 unchanged**

All expectations from Task 4 Step 4 and Task 5 Step 3 must still hold with CodeMirror gone (this catches any lingering reference).

- [ ] **Step 4: v1 file round trip**

Create `old.mnb` containing `{"cells": [{"input": "a:=2", "output_latex": null, "error": null}, {"input": "solve(x^2 = 4, x)", "output_latex": null, "error": null}]}` and probe: `api.load_notebook('<abs path>')` from the probe script, then `renderCells(...)` with those cells and `runAll()`. Expected: cell 0 field non-empty (`a:=2` imported), both outputs render (`2` and the two roots), and after `saveNotebook` via `api.save_notebook(path)` the file's cells have a `latex` key. Delete `old.mnb`.

- [ ] **Step 5: Final screenshot**

As Task 4 Step 5, with a cell containing `\frac{x^{2}}{2}+\sqrt{x}` and a template just inserted (placeholder boxes visible). Confirm visually, delete the image.

- [ ] **Step 6: Delete the probe files and commit**

```bash
rm -f probe_cells.py probe_result.json
git add -A frontend/index.html
git commit -m "Remove CodeMirror; math-field is the only cell editor"
```
