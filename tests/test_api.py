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
