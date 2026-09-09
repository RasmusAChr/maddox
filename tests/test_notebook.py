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
        "cells": [{"input": "x:=1", "output_latex": "1", "error": None, "latex": None}]
    }


def test_from_dict_ignores_missing_cells_key():
    nb = Notebook.from_dict({})
    assert nb.cells == []


def test_add_cell_returns_the_new_cell():
    nb = Notebook()
    cell = nb.add_cell(input_text="a:=2", latex="a\\coloneq2")
    assert cell == {"input": "a:=2", "output_latex": None, "error": None, "latex": "a\\coloneq2"}
    assert nb.cells == [cell]
