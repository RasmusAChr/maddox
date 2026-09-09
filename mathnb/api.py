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

    def new_notebook(self):
        self.notebook = Notebook()
        self.engine.reset()
        self.current_path = None
        return self.notebook.cells

    def save_notebook(self, path=None):
        try:
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
        except Exception as e:
            return {"ok": False, "error": str(e)}

    def load_notebook(self, path=None):
        try:
            target = path
            if not target:
                chosen = webview.windows[0].create_file_dialog(webview.OPEN_DIALOG)
                if not chosen:
                    return {"ok": False, "error": "Open cancelled"}
                target = chosen if isinstance(chosen, str) else chosen[0]
            self.notebook = Notebook.load(target)
            self.engine.reset()
            self.current_path = target
            return {"ok": True, "path": target, "cells": self.notebook.cells}
        except Exception as e:
            return {"ok": False, "error": str(e)}
