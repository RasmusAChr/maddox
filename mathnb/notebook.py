import json


class Notebook:
    def __init__(self, cells=None):
        self.cells = cells if cells is not None else []

    def add_cell(self, input_text="", output_latex=None, error=None, latex=None):
        cell = {"input": input_text, "output_latex": output_latex, "error": error, "latex": latex}
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
