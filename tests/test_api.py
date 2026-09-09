# tests/test_api.py
from unittest.mock import MagicMock, patch

from mathnb.api import Api


def test_evaluate_cell_appends_a_new_cell():
    api = Api()
    cell = api.evaluate_cell(None, "a:=2")
    assert cell == {"latex": "a:=2", "input": "a:=2", "output_latex": "2", "error": None}
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


def test_load_notebook_opens_a_dialog_when_no_path_is_given(tmp_path):
    api = Api()
    api.evaluate_cell(None, "a:=2")
    path = str(tmp_path / "dialog.mnb")
    api.save_notebook(path)

    fake_window = MagicMock()
    fake_window.create_file_dialog.return_value = path

    api2 = Api()
    with patch("mathnb.api.webview.windows", [fake_window]):
        result = api2.load_notebook()

    assert result["ok"] is True
    assert result["path"] == path
    fake_window.create_file_dialog.assert_called_once()


def test_set_cell_texts_updates_existing_and_appends_new_cells():
    api = Api()
    api.evaluate_cell(None, "a:=2")
    cells = api.set_cell_texts(["a:=3", "b:=4"])
    assert cells[0]["latex"] == "a:=3"
    assert cells[0]["input"] == "a:=3"
    assert cells[0]["output_latex"] == "2"  # cached output kept until re-run
    assert cells[1] == {"latex": "b:=4", "input": "b:=4", "output_latex": None, "error": None}


def test_set_cell_texts_truncates_cells_beyond_the_given_texts():
    api = Api()
    api.evaluate_cell(None, "a:=2")
    api.evaluate_cell(None, "b:=3")
    api.evaluate_cell(None, "c:=4")

    cells = api.set_cell_texts(["a:=2"])

    assert len(cells) == 1
    assert api.notebook.cells == cells


def test_out_of_order_run_desyncs_indices_without_sync():
    # Reproduces Critical #1: DOM cell 1 is run before DOM cell 0 ever is.
    # evaluate_cell's append/overwrite-by-index logic has no notion of DOM
    # position, so both calls land at backend index 0 and cell 1's content
    # is silently lost -- this is the confirmed buggy behavior.
    api = Api()
    api.evaluate_cell(1, "b:=3")  # index 1 doesn't exist yet -> appended at 0
    api.evaluate_cell(0, "a:=2")  # overwrites index 0, destroying "b:=3"

    assert len(api.notebook.cells) == 1
    assert api.notebook.cells[0]["input"] == "a:=2"


def test_set_cell_texts_corrects_the_out_of_order_desync():
    # Same starting scenario as above, but the frontend calls
    # set_cell_texts with the DOM's actual current texts (keyed strictly by
    # DOM position) before Save/Run All read the backend array.
    api = Api()
    api.evaluate_cell(1, "b:=3")
    api.evaluate_cell(0, "a:=2")
    assert len(api.notebook.cells) == 1  # still desynced at this point

    cells = api.set_cell_texts(["a:=2", "b:=3"])

    assert len(cells) == 2
    assert cells[0]["input"] == "a:=2"
    assert cells[1]["input"] == "b:=3"


def test_set_cell_texts_then_save_then_run_all_round_trip(tmp_path):
    # Recommendation 2b: build a notebook via set_cell_texts, save it,
    # load it fresh, run_all, and confirm outputs match.
    api = Api()
    api.set_cell_texts(["a:=2", "x:=a+1"])
    path = str(tmp_path / "roundtrip.mnb")

    save_result = api.save_notebook(path)
    assert save_result["ok"] is True

    api2 = Api()
    load_result = api2.load_notebook(path)
    assert load_result["ok"] is True
    assert [c["input"] for c in load_result["cells"]] == ["a:=2", "x:=a+1"]

    results = api2.run_all()
    assert results[0]["output_latex"] == "2"
    assert results[1]["output_latex"] == "3"


def test_load_notebook_on_invalid_json_returns_error_instead_of_raising(tmp_path):
    bad_path = tmp_path / "bad.mnb"
    bad_path.write_text("not json", encoding="utf-8")

    api = Api()
    result = api.load_notebook(str(bad_path))

    assert result["ok"] is False
    assert "error" in result


def test_save_notebook_to_nonexistent_directory_returns_error_instead_of_raising(tmp_path):
    api = Api()
    api.evaluate_cell(None, "a:=2")
    bad_path = str(tmp_path / "no" / "such" / "dir" / "x.mnb")

    result = api.save_notebook(bad_path)

    assert result["ok"] is False
    assert "error" in result


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


def test_set_cell_texts_keeps_engine_text_when_the_latex_does_not_convert():
    # A v1 cell's imported LaTeX may not convert; Save must not blank its input.
    api = Api()
    api.evaluate_cell(None, "a:=2")
    cells = api.set_cell_texts([r"a\coloneq\foo"])
    assert cells[0]["input"] == "a:=2"
    assert cells[0]["latex"] == r"a\coloneq\foo"
    assert "Unsupported notation" in cells[0]["error"]
    assert cells[0]["output_latex"] is None


def test_set_cell_texts_appends_an_errored_cell_for_unsupported_latex():
    api = Api()
    cells = api.set_cell_texts([r"\foo"])
    assert cells[0]["latex"] == r"\foo"
    assert cells[0]["input"] == ""
    assert cells[0]["output_latex"] is None
    assert "Unsupported notation" in cells[0]["error"]


def test_set_cell_texts_survives_a_save_load_round_trip_with_bad_latex(tmp_path):
    api = Api()
    api.evaluate_cell(None, "a:=2")
    api.set_cell_texts([r"a\coloneq\foo"])
    path = str(tmp_path / "kept.mnb")
    assert api.save_notebook(path)["ok"] is True

    api2 = Api()
    result = api2.load_notebook(path)
    assert result["cells"][0]["input"] == "a:=2"


def test_v1_cells_without_latex_still_run(tmp_path):
    path = tmp_path / "old.mnb"
    path.write_text('{"cells": [{"input": "a:=2", "output_latex": null, "error": null}]}')
    api = Api()
    api.load_notebook(str(path))
    results = api.run_all()
    assert results[0]["output_latex"] == "2"
    assert results[0]["latex"] is None
