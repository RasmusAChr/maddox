# Math Notebook Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a free, personal, cross-platform (Windows + Linux) notebook-style math app with Nspire/WordMat-style `:=` assignment syntax, backed by SymPy for CAS and linear algebra.

**Architecture:** A single Python process runs a `pywebview` window (no HTTP server) with an HTML/JS notebook frontend. An `Api` class bridges JS to Python via pywebview's `js_api`. A persistent SymPy namespace (`Engine`) evaluates each cell's text after a small pre-processing layer (`parser.py`) classifies it as an assignment (`:=`) or a plain expression (with any bare `=` auto-wrapped as `Eq(...)`). Notebooks persist to disk as JSON (`Notebook`).

**Tech Stack:** Python 3.11+, SymPy, pywebview, pytest, vanilla HTML/CSS/JS, CodeMirror 5 (CDN), KaTeX (CDN).

**Spec:** `docs/superpowers/specs/2026-09-09-math-notebook-design.md`

## Global Constraints

- Strict `=` vs `:=` distinction — `=` is always an equation, `:=` is always an assignment; never guess one for the other.
- No live/spreadsheet-style recalculation — cells only re-run top-to-bottom on demand (single cell "Run", or whole-notebook "Run All").
- No auto-save — saving is always an explicit user action.
- Notebook files on disk serialize only cell input text and cached `output_latex`/`error` — never live SymPy objects.
- No packaging/installer in v1 — the app runs via `python app.py` from a virtualenv.
- No automated frontend/UI tests in v1 — `parser`, `engine`, `notebook`, and `api` get pytest coverage; the frontend gets manual verification only.
- Single notebook open per window; no tabs, no multi-window.
- No network server of any kind — only pywebview's in-process `js_api` bridge.

---

### Task 1: Project scaffolding + pywebview shell

**Files:**
- Create: `requirements.txt`
- Create: `mathnb/__init__.py`
- Create: `app.py`
- Create: `frontend/index.html`
- Create: `frontend/style.css`
- Create: `.gitignore`

**Interfaces:**
- Produces: a runnable `python app.py` that opens a pywebview window titled "Math Notebook" pointed at `frontend/index.html`. Later tasks replace the placeholder HTML/CSS and add the `Api` bridge.

- [ ] **Step 1: Create `requirements.txt`**

```
sympy>=1.12
pywebview>=5.0
pytest>=8.0
```

- [ ] **Step 2: Create `mathnb/__init__.py`** (empty file, makes `mathnb` a package)

- [ ] **Step 3: Create placeholder `frontend/index.html`**

```html
<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>Math Notebook</title>
  <link rel="stylesheet" href="style.css">
</head>
<body>
  <h1>Math Notebook</h1>
  <p>Scaffolding complete. Cell UI arrives in a later task.</p>
</body>
</html>
```

- [ ] **Step 4: Create placeholder `frontend/style.css`**

```css
body {
  font-family: system-ui, sans-serif;
  margin: 1.5rem;
}
```

- [ ] **Step 5: Create `app.py`**

```python
import webview


def main():
    webview.create_window(
        "Math Notebook",
        "frontend/index.html",
        width=900,
        height=700,
    )
    webview.start()


if __name__ == "__main__":
    main()
```

- [ ] **Step 6: Create `.gitignore`**

```
__pycache__/
*.pyc
.venv/
venv/
```

- [ ] **Step 7: Install dependencies and verify the window opens**

```bash
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
python app.py
```

Expected: a window titled "Math Notebook" opens showing the heading "Math Notebook" and the placeholder paragraph. Close the window to end the process.

(Note for a future Linux run: pywebview needs a system webview backend — e.g. `sudo apt install python3-gi gir1.2-webkit2-4.1` — not installable via pip alone. Not needed to verify this task on this Windows machine.)

- [ ] **Step 8: Commit**

```bash
git add requirements.txt mathnb/__init__.py app.py frontend/index.html frontend/style.css .gitignore
git commit -m "Scaffold project: pywebview shell opens a placeholder window"
```

---

### Task 2: Cell text classification (assignment vs. expression/equation)

**Files:**
- Create: `mathnb/parser.py`
- Test: `tests/test_parser.py`

**Interfaces:**
- Produces: `classify(cell_text: str) -> Assignment | Expression`
  - `Assignment(name: str, expr_text: str)` — `name` is a bare identifier, `expr_text` is the text to the right of `:=`.
  - `Expression(text: str)` — the cell text, with any bare `=` (not part of `:=`, `<=`, `>=`, `!=`, `==`) rewritten as `Eq(lhs, rhs)`, wherever it appears (top-level or nested inside a function call's arguments).
  - Raises `ValueError` if the left side of `:=` is not a valid identifier.

- [ ] **Step 1: Write the failing tests**

```python
# tests/test_parser.py
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
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pytest tests/test_parser.py -v
```

Expected: FAIL with `ModuleNotFoundError: No module named 'mathnb.parser'`.

- [ ] **Step 3: Implement `mathnb/parser.py`**

```python
import re


class Assignment:
    def __init__(self, name, expr_text):
        self.name = name
        self.expr_text = expr_text


class Expression:
    def __init__(self, text):
        self.text = text


_IDENTIFIER = re.compile(r"[A-Za-z_][A-Za-z0-9_]*")


def classify(cell_text):
    text = cell_text.strip()
    if ":=" in text:
        name, expr_text = text.split(":=", 1)
        name = name.strip()
        if not _IDENTIFIER.fullmatch(name):
            raise ValueError(f"Invalid assignment target: {name!r}")
        return Assignment(name, expr_text.strip())
    return Expression(_wrap_bare_equations(text))


def _wrap_bare_equations(text):
    replacements = _find_bare_equations(text)
    if not replacements:
        return text
    pieces = []
    cursor = 0
    for start, end, lhs, rhs in replacements:
        pieces.append(text[cursor:start])
        # Preserve any leading whitespace within the segment (e.g. the
        # space after a comma) — without this, the second+ equation in
        # a multi-equation cell like `solve([x = 1, y = 2], [x, y])`
        # loses its leading space.
        seg_text = text[start:end]
        leading_ws_count = len(seg_text) - len(seg_text.lstrip())
        pieces.append(seg_text[:leading_ws_count])
        pieces.append(f"Eq({lhs}, {rhs})")
        cursor = end
    pieces.append(text[cursor:])
    return "".join(pieces)


def _find_bare_equations(text):
    """Find each bare '=' (not :=, <=, >=, !=, ==) and the boundaries of
    the argument/segment it sits in (bounded by the nearest enclosing
    '(', '[', ',', or start/end of string at the same nesting depth)."""
    depth = 0
    seg_start_stack = [0]
    replacements = []
    i = 0
    n = len(text)
    while i < n:
        ch = text[i]
        if ch in "([":
            depth += 1
            seg_start_stack.append(i + 1)
            i += 1
            continue
        if ch in ")]":
            depth -= 1
            seg_start_stack.pop()
            i += 1
            continue
        if ch == ",":
            seg_start_stack[-1] = i + 1
            i += 1
            continue
        if ch == "=":
            prev_ch = text[i - 1] if i > 0 else ""
            next_ch = text[i + 1] if i + 1 < n else ""
            if prev_ch in "<>=!" or next_ch == "=":
                i += 2 if next_ch == "=" else 1
                continue
            seg_start = seg_start_stack[-1]
            j = i + 1
            d = depth
            while j < n:
                c = text[j]
                if c in "([":
                    d += 1
                elif c in ")]":
                    if d == depth:
                        break
                    d -= 1
                elif c == "," and d == depth:
                    break
                j += 1
            seg_end = j
            lhs = text[seg_start:i].strip()
            rhs = text[i + 1:seg_end].strip()
            replacements.append((seg_start, seg_end, lhs, rhs))
            i = seg_end
            continue
        i += 1
    return replacements
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pytest tests/test_parser.py -v
```

Expected: PASS (all 8 tests).

- [ ] **Step 5: Commit**

```bash
git add mathnb/parser.py tests/test_parser.py
git commit -m "Add cell text classifier: assignment vs. expression/equation"
```

---

### Task 3: Compute engine (SymPy evaluation over a persistent namespace)

**Files:**
- Create: `mathnb/engine.py`
- Test: `tests/test_engine.py`

**Interfaces:**
- Consumes: `mathnb.parser.classify`, `Assignment` (Task 2).
- Produces: `Engine` class:
  - `__init__(self)` — builds `self.namespace: dict` (starts empty; holds only user-assigned variables).
  - `reset(self) -> None` — clears `self.namespace` back to empty.
  - `evaluate(self, cell_text: str) -> dict` — returns `{"output_latex": str | None, "error": str | None}`. Never raises.

- [ ] **Step 1: Write the failing tests**

```python
# tests/test_engine.py
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
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pytest tests/test_engine.py -v
```

Expected: FAIL with `ModuleNotFoundError: No module named 'mathnb.engine'`.

- [ ] **Step 3: Implement `mathnb/engine.py`**

```python
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
        except ValueError as e:
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
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pytest tests/test_engine.py -v
```

Expected: PASS (all 8 tests).

- [ ] **Step 5: Commit**

```bash
git add mathnb/engine.py tests/test_engine.py
git commit -m "Add SymPy compute engine with persistent per-notebook namespace"
```

---

### Task 4: Notebook file model (JSON persistence)

**Files:**
- Create: `mathnb/notebook.py`
- Test: `tests/test_notebook.py`

**Interfaces:**
- Produces: `Notebook` class:
  - `__init__(self, cells=None)` — `self.cells: list[dict]`, each `{"input": str, "output_latex": str | None, "error": str | None}`.
  - `add_cell(self, input_text="", output_latex=None, error=None) -> dict` — appends and returns the new cell dict.
  - `to_dict(self) -> dict` — `{"cells": self.cells}`.
  - `Notebook.from_dict(data: dict) -> Notebook` (classmethod).
  - `save(self, path: str) -> None` — writes JSON to `path`.
  - `Notebook.load(path: str) -> Notebook` (classmethod) — reads JSON from `path`.

- [ ] **Step 1: Write the failing tests**

```python
# tests/test_notebook.py
import json
from mathnb.notebook import Notebook


def test_round_trip_save_and_load(tmp_path):
    nb = Notebook()
    nb.add_cell(input_text="a:=2", output_latex="2", error=None)
    nb.add_cell(input_text="b:=4", output_latex="4", error=None)

    path = tmp_path / "test.mnb"
    nb.save(str(path))

    loaded = Notebook.load(str(path))
    assert loaded.cells == nb.cells


def test_save_writes_expected_json_shape(tmp_path):
    nb = Notebook()
    nb.add_cell(input_text="x:=1", output_latex="1", error=None)
    path = tmp_path / "test.mnb"
    nb.save(str(path))

    with open(path) as f:
        data = json.load(f)

    assert data == {
        "cells": [{"input": "x:=1", "output_latex": "1", "error": None}]
    }


def test_from_dict_ignores_missing_cells_key():
    nb = Notebook.from_dict({})
    assert nb.cells == []


def test_add_cell_returns_the_new_cell():
    nb = Notebook()
    cell = nb.add_cell(input_text="a:=2")
    assert cell == {"input": "a:=2", "output_latex": None, "error": None}
    assert nb.cells == [cell]
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pytest tests/test_notebook.py -v
```

Expected: FAIL with `ModuleNotFoundError: No module named 'mathnb.notebook'`.

- [ ] **Step 3: Implement `mathnb/notebook.py`**

```python
import json


class Notebook:
    def __init__(self, cells=None):
        self.cells = cells if cells is not None else []

    def add_cell(self, input_text="", output_latex=None, error=None):
        cell = {"input": input_text, "output_latex": output_latex, "error": error}
        self.cells.append(cell)
        return cell

    def to_dict(self):
        return {"cells": self.cells}

    @classmethod
    def from_dict(cls, data):
        return cls(cells=list(data.get("cells", [])))

    def save(self, path):
        with open(path, "w", encoding="utf-8") as f:
            json.dump(self.to_dict(), f, indent=2)

    @classmethod
    def load(cls, path):
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
        return cls.from_dict(data)
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pytest tests/test_notebook.py -v
```

Expected: PASS (all 4 tests).

- [ ] **Step 5: Commit**

```bash
git add mathnb/notebook.py tests/test_notebook.py
git commit -m "Add Notebook JSON persistence model"
```

---

### Task 5: pywebview API bridge

**Files:**
- Create: `mathnb/api.py`
- Modify: `app.py` (wire `Api` in as `js_api`)
- Test: `tests/test_api.py`

**Interfaces:**
- Consumes: `Engine` (Task 3), `Notebook` (Task 4).
- Produces: `Api` class:
  - `__init__(self)` — `self.engine = Engine()`, `self.notebook = Notebook()`, `self.current_path: str | None = None`.
  - `evaluate_cell(self, index: int | None, text: str) -> dict` — evaluates `text`, stores/overwrites the cell at `index` in `self.notebook.cells` (appends if `index is None` or `index >= len(cells)`), returns the cell dict.
  - `run_all(self) -> list[dict]` — resets the engine, re-evaluates every cell in `self.notebook.cells` in order, updates them in place, returns the updated list.
  - `new_notebook(self) -> list[dict]` — replaces `self.notebook` with an empty one, resets the engine, clears `self.current_path`, returns `[]`.
  - `save_notebook(self, path: str | None = None) -> dict` — `{"ok": True, "path": str}` or `{"ok": False, "error": str}`. Uses `path` if given, else `self.current_path`, else opens a save dialog via `webview.windows[0].create_file_dialog(...)`.
  - `load_notebook(self, path: str | None = None) -> dict` — `{"ok": True, "path": str, "cells": list[dict]}` or `{"ok": False, "error": str}`. Uses `path` if given, else opens an open dialog.

- [ ] **Step 1: Write the failing tests**

```python
# tests/test_api.py
from unittest.mock import MagicMock, patch

from mathnb.api import Api


def test_evaluate_cell_appends_a_new_cell():
    api = Api()
    cell = api.evaluate_cell(None, "a:=2")
    assert cell == {"input": "a:=2", "output_latex": "2", "error": None}
    assert api.notebook.cells == [cell]


def test_evaluate_cell_overwrites_an_existing_index():
    api = Api()
    api.evaluate_cell(None, "a:=2")
    updated = api.evaluate_cell(0, "a:=5")
    assert updated["output_latex"] == "5"
    assert len(api.notebook.cells) == 1


def test_run_all_rebuilds_the_namespace_in_stored_order():
    api = Api()
    api.evaluate_cell(None, "a:=2")
    api.evaluate_cell(None, "x:=a+1")
    api.evaluate_cell(None, "a:=10")

    results = api.run_all()

    assert results[1]["output_latex"] == "3"


def test_new_notebook_resets_state():
    api = Api()
    api.evaluate_cell(None, "a:=2")
    cells = api.new_notebook()
    assert cells == []
    assert api.notebook.cells == []
    assert api.current_path is None


def test_save_and_load_notebook_with_an_explicit_path(tmp_path):
    api = Api()
    api.evaluate_cell(None, "a:=2")
    path = str(tmp_path / "nb.mnb")

    result = api.save_notebook(path)
    assert result == {"ok": True, "path": path}

    api2 = Api()
    result = api2.load_notebook(path)
    assert result["ok"] is True
    assert result["cells"] == api.notebook.cells


def test_save_notebook_opens_a_dialog_when_no_path_is_known(tmp_path):
    api = Api()
    api.evaluate_cell(None, "a:=2")
    fake_path = str(tmp_path / "dialog.mnb")

    fake_window = MagicMock()
    fake_window.create_file_dialog.return_value = fake_path

    with patch("mathnb.api.webview.windows", [fake_window]):
        result = api.save_notebook()

    assert result == {"ok": True, "path": fake_path}
    fake_window.create_file_dialog.assert_called_once()


def test_save_notebook_cancelled_dialog_returns_not_ok():
    api = Api()
    api.evaluate_cell(None, "a:=2")

    fake_window = MagicMock()
    fake_window.create_file_dialog.return_value = None

    with patch("mathnb.api.webview.windows", [fake_window]):
        result = api.save_notebook()

    assert result == {"ok": False, "error": "Save cancelled"}
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pytest tests/test_api.py -v
```

Expected: FAIL with `ModuleNotFoundError: No module named 'mathnb.api'`.

- [ ] **Step 3: Implement `mathnb/api.py`**

```python
import webview

from .engine import Engine
from .notebook import Notebook


class Api:
    def __init__(self):
        self.engine = Engine()
        self.notebook = Notebook()
        self.current_path = None

    def evaluate_cell(self, index, text):
        result = self.engine.evaluate(text)
        cell = {"input": text, "output_latex": result["output_latex"], "error": result["error"]}
        if index is None or index >= len(self.notebook.cells):
            self.notebook.cells.append(cell)
        else:
            self.notebook.cells[index] = cell
        return cell

    def run_all(self):
        self.engine.reset()
        for i, cell in enumerate(self.notebook.cells):
            result = self.engine.evaluate(cell["input"])
            self.notebook.cells[i] = {
                "input": cell["input"],
                "output_latex": result["output_latex"],
                "error": result["error"],
            }
        return self.notebook.cells

    def new_notebook(self):
        self.notebook = Notebook()
        self.engine.reset()
        self.current_path = None
        return self.notebook.cells

    def save_notebook(self, path=None):
        target = path or self.current_path
        if not target:
            chosen = webview.windows[0].create_file_dialog(
                webview.SAVE_DIALOG, save_filename="notebook.mnb"
            )
            if not chosen:
                return {"ok": False, "error": "Save cancelled"}
            target = chosen if isinstance(chosen, str) else chosen[0]
        self.notebook.save(target)
        self.current_path = target
        return {"ok": True, "path": target}

    def load_notebook(self, path=None):
        target = path
        if not target:
            chosen = webview.windows[0].create_file_dialog(webview.OPEN_DIALOG)
            if not chosen:
                return {"ok": False, "error": "Open cancelled"}
            target = chosen[0]
        self.notebook = Notebook.load(target)
        self.engine.reset()
        self.current_path = target
        return {"ok": True, "path": target, "cells": self.notebook.cells}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pytest tests/test_api.py -v
```

Expected: PASS (all 7 tests).

- [ ] **Step 5: Wire `Api` into `app.py`**

```python
import webview

from mathnb.api import Api


def main():
    api = Api()
    webview.create_window(
        "Math Notebook",
        "frontend/index.html",
        js_api=api,
        width=900,
        height=700,
    )
    webview.start()


if __name__ == "__main__":
    main()
```

- [ ] **Step 6: Run the full test suite**

```bash
pytest -v
```

Expected: PASS (all tests from Tasks 2-5).

- [ ] **Step 7: Commit**

```bash
git add mathnb/api.py app.py tests/test_api.py
git commit -m "Add pywebview Api bridge wiring Engine and Notebook together"
```

---

### Task 6: Frontend core cell loop (render, add, run, KaTeX output)

**Files:**
- Modify: `frontend/index.html`
- Modify: `frontend/style.css`
- Create: `frontend/notebook.js`

**Interfaces:**
- Consumes: `window.pywebview.api.evaluate_cell(index, text)` (Task 5).
- Produces (JS functions used by Task 7 and Task 8): `createCellElement(cell, index)`, `renderOutput(outputDiv, cell)`, `runCell(index)`, `addCell()`, module-level array `cellEditors` (parallel to rendered cells, holding CodeMirror instances).

- [ ] **Step 1: Replace `frontend/index.html`**

```html
<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>Math Notebook</title>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.css">
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/codemirror@5.65.16/lib/codemirror.min.css">
  <link rel="stylesheet" href="style.css">
</head>
<body>
  <div id="toolbar">
    <button id="add-cell-btn">+ Cell</button>
  </div>
  <div id="cells"></div>

  <script src="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/codemirror@5.65.16/lib/codemirror.min.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/codemirror@5.65.16/mode/python/python.min.js"></script>
  <script src="notebook.js"></script>
</body>
</html>
```

- [ ] **Step 2: Replace `frontend/style.css`**

```css
body {
  font-family: system-ui, sans-serif;
  margin: 0;
  background: #f7f7f8;
}

#toolbar {
  padding: 0.5rem 1rem;
  background: #fff;
  border-bottom: 1px solid #ddd;
}

#toolbar button {
  margin-right: 0.5rem;
}

#cells {
  padding: 1rem;
}

.cell {
  background: #fff;
  border: 1px solid #ddd;
  border-radius: 6px;
  margin-bottom: 0.75rem;
  padding: 0.5rem;
}

.CodeMirror {
  border: 1px solid #eee;
  height: auto;
}

.output {
  margin-top: 0.5rem;
  padding: 0.25rem 0.5rem;
  min-height: 1.5rem;
}

.output.error {
  color: #b00020;
  font-family: monospace;
  white-space: pre-wrap;
}
```

- [ ] **Step 3: Create `frontend/notebook.js`**

```javascript
let cellEditors = [];

function createCellElement(cell, index) {
  const wrapper = document.createElement("div");
  wrapper.className = "cell";
  wrapper.dataset.index = index;

  const inputArea = document.createElement("textarea");
  inputArea.value = cell.input || "";
  wrapper.appendChild(inputArea);

  const runBtn = document.createElement("button");
  runBtn.textContent = "Run";
  runBtn.onclick = () => runCell(index);
  wrapper.appendChild(runBtn);

  const outputDiv = document.createElement("div");
  outputDiv.className = "output";
  wrapper.appendChild(outputDiv);

  document.getElementById("cells").appendChild(wrapper);

  const editor = CodeMirror.fromTextArea(inputArea, {
    mode: "text/x-python",
    lineNumbers: false,
    viewportMargin: Infinity,
  });
  cellEditors[index] = editor;

  renderOutput(outputDiv, cell);
  return wrapper;
}

function renderOutput(outputDiv, cell) {
  outputDiv.innerHTML = "";
  outputDiv.classList.remove("error");
  if (cell.error) {
    outputDiv.classList.add("error");
    outputDiv.textContent = cell.error;
  } else if (cell.output_latex) {
    katex.render(cell.output_latex, outputDiv, { throwOnError: false });
  }
}

async function runCell(index) {
  const text = cellEditors[index].getValue();
  const cell = await window.pywebview.api.evaluate_cell(index, text);
  const wrapper = document.querySelector(`.cell[data-index="${index}"]`);
  renderOutput(wrapper.querySelector(".output"), cell);
}

function addCell() {
  const index = cellEditors.length;
  createCellElement({ input: "", output_latex: null, error: null }, index);
}

window.addEventListener("pywebviewready", () => {
  document.getElementById("add-cell-btn").onclick = addCell;
  addCell();
});
```

- [ ] **Step 4: Manual verification**

Run `python app.py`. Confirm:
1. Window opens with a "+ Cell" button and one empty cell already present.
2. Typing `a:=2` into the cell and clicking "Run" renders `2` below it (via KaTeX, not raw LaTeX source text).
3. Clicking "+ Cell" adds a second empty cell; typing `x:=a+3` and clicking Run on it renders `5`.
4. Typing something invalid (e.g. `solve(x^2 = , x)`) into a cell and clicking Run shows a red error message in that cell's output, and other cells are unaffected.

- [ ] **Step 5: Commit**

```bash
git add frontend/index.html frontend/style.css frontend/notebook.js
git commit -m "Add frontend cell loop: type, run, render KaTeX output per cell"
```

---

### Task 7: New / Open / Save wiring

**Files:**
- Modify: `frontend/index.html` (toolbar buttons)
- Modify: `frontend/notebook.js`

**Interfaces:**
- Consumes: `window.pywebview.api.new_notebook()`, `save_notebook()`, `load_notebook()` (Task 5); `createCellElement` (Task 6).
- Produces: `clearCells()`, `newNotebook()`, `openNotebook()`, `saveNotebook()` JS functions, wired to toolbar buttons.

- [ ] **Step 1: Add toolbar buttons in `frontend/index.html`**

```html
  <div id="toolbar">
    <button id="new-btn">New</button>
    <button id="open-btn">Open</button>
    <button id="save-btn">Save</button>
    <button id="add-cell-btn">+ Cell</button>
  </div>
```

(Replaces the existing `#toolbar` div from Task 6, which only had the `+ Cell` button.)

- [ ] **Step 2: Add functions to `frontend/notebook.js`**

```javascript
function clearCells() {
  document.getElementById("cells").innerHTML = "";
  cellEditors = [];
}

async function newNotebook() {
  await window.pywebview.api.new_notebook();
  clearCells();
  addCell();
}

async function openNotebook() {
  const result = await window.pywebview.api.load_notebook();
  if (!result.ok) return;
  clearCells();
  result.cells.forEach((cell, i) => createCellElement(cell, i));
  if (result.cells.length === 0) addCell();
}

async function saveNotebook() {
  await window.pywebview.api.save_notebook();
}
```

- [ ] **Step 3: Wire the new buttons in the `pywebviewready` handler**

Replace the existing handler at the bottom of `frontend/notebook.js`:

```javascript
window.addEventListener("pywebviewready", () => {
  document.getElementById("new-btn").onclick = newNotebook;
  document.getElementById("open-btn").onclick = openNotebook;
  document.getElementById("save-btn").onclick = saveNotebook;
  document.getElementById("add-cell-btn").onclick = addCell;
  addCell();
});
```

- [ ] **Step 4: Manual verification**

Run `python app.py`. Confirm:
1. Enter `a:=2`, Run; add a second cell `x:=a+3`, Run.
2. Click "Save" — a native save dialog opens; save as `test.mnb` somewhere convenient.
3. Close the app entirely, then run `python app.py` again (a fresh process — this is not testing live in-memory state).
4. Click "Open", pick `test.mnb` — both cells reappear with their input text (`a:=2`, `x:=a+3`) and their last computed output (`2`, `5`) displayed, without needing to click Run.
5. Click "New" — the notebook clears back to a single empty cell.

- [ ] **Step 5: Commit**

```bash
git add frontend/index.html frontend/notebook.js
git commit -m "Wire New/Open/Save toolbar actions to the Api bridge"
```

---

### Task 8: Run All wiring + full manual smoke test

**Files:**
- Modify: `frontend/index.html` (Run All button)
- Modify: `frontend/notebook.js`

**Interfaces:**
- Consumes: `window.pywebview.api.run_all()` (Task 5).
- Produces: `runAll()` JS function wired to a "Run All" button. This is the last task — v1 is complete once its manual smoke test passes.

- [ ] **Step 1: Add the "Run All" button in `frontend/index.html`**

```html
  <div id="toolbar">
    <button id="new-btn">New</button>
    <button id="open-btn">Open</button>
    <button id="save-btn">Save</button>
    <button id="run-all-btn">Run All</button>
    <button id="add-cell-btn">+ Cell</button>
  </div>
```

- [ ] **Step 2: Add `runAll()` to `frontend/notebook.js`**

```javascript
async function runAll() {
  const results = await window.pywebview.api.run_all();
  results.forEach((cell, index) => {
    const wrapper = document.querySelector(`.cell[data-index="${index}"]`);
    renderOutput(wrapper.querySelector(".output"), cell);
  });
}
```

- [ ] **Step 3: Wire the button in the `pywebviewready` handler**

```javascript
window.addEventListener("pywebviewready", () => {
  document.getElementById("new-btn").onclick = newNotebook;
  document.getElementById("open-btn").onclick = openNotebook;
  document.getElementById("save-btn").onclick = saveNotebook;
  document.getElementById("run-all-btn").onclick = runAll;
  document.getElementById("add-cell-btn").onclick = addCell;
  addCell();
});
```

- [ ] **Step 4: Manual verification — after opening a saved notebook, "Run All" rebuilds the live namespace**

Run `python app.py`. Confirm:
1. Build a notebook: `a:=2`, `b:=4`, `x:=a+b` (Run each). Save it.
2. Close and reopen the app, Open the saved file — cells show cached text/output (`6` for `x`) but the namespace is not yet live.
3. Edit the `a:=2` cell to `a:=10` and click its own Run — only that cell updates (still shows `10`), `x` still displays its old cached `6`.
4. Click "Run All" — `x` updates to `14`, confirming top-to-bottom re-evaluation rebuilds the namespace from the current cell contents.

- [ ] **Step 5: Run the full spec smoke-test checklist end to end**

Using the running app, confirm each item from the design spec's Testing section:
1. **Assignment:** `a:=2` displays `2`.
2. **Equation + solve:** `solve(x^2 = 4, x)` displays the two roots.
3. **Matrix operations:** `A:=Matrix([[1,2],[3,4]])` then `det(A)` displays `-2`.
4. **Error isolation:** an intentionally malformed cell shows a red error, and a valid cell before or after it still evaluates correctly.
5. **Save/reload:** saving and reopening a notebook restores cell text and last output, and "Run All" correctly rebuilds a working live namespace.

- [ ] **Step 6: Run the full automated test suite one more time**

```bash
pytest -v
```

Expected: PASS (all tests from Tasks 2, 3, 4, 5).

- [ ] **Step 7: Commit**

```bash
git add frontend/index.html frontend/notebook.js
git commit -m "Wire Run All action; completes v1 notebook feature set"
```
