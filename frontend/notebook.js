let cellEditors = [];
let phantomEditor = null;

function buildCellDom() {
  const wrapper = document.createElement("div");
  wrapper.className = "cell";

  const main = document.createElement("div");
  main.className = "cell-main";
  wrapper.appendChild(main);

  const inputArea = document.createElement("textarea");
  main.appendChild(inputArea);

  const outputDiv = document.createElement("div");
  outputDiv.className = "output";
  main.appendChild(outputDiv);

  const actions = document.createElement("div");
  actions.className = "cell-actions";
  wrapper.appendChild(actions);

  const runBtn = document.createElement("button");
  runBtn.className = "run-btn";
  runBtn.textContent = "Run";
  actions.appendChild(runBtn);

  return { wrapper, main, inputArea, outputDiv, runBtn };
}

// getIndex() returns this editor's current cell index — a fixed number for
// a real cell, or cellEditors.length (its prospective index) for the
// not-yet-promoted phantom cell.
function makeExtraKeys(getIndex) {
  return {
    "Ctrl-Enter": () => {
      const i = getIndex();
      if (i < cellEditors.length) runCell(i);
    },
    "Enter": () => {
      moveToNextCell(getIndex());
    },
    "Shift-Enter": "newlineAndIndent",
    "Up": function (cm) {
      if (cm.getCursor().line === 0) {
        moveToPrevCell(getIndex());
      } else {
        return CodeMirror.Pass;
      }
    },
    "Down": function (cm) {
      if (cm.getCursor().line === cm.lastLine()) {
        moveToNextCell(getIndex());
      } else {
        return CodeMirror.Pass;
      }
    },
  };
}

function focusEditor(editor, pos) {
  editor.focus();
  editor.setCursor(pos);
}

function moveToNextCell(index) {
  const nextIndex = index + 1;
  if (nextIndex < cellEditors.length) {
    focusEditor(cellEditors[nextIndex], { line: 0, ch: 0 });
  } else if (phantomEditor && index < cellEditors.length) {
    focusEditor(phantomEditor, { line: 0, ch: 0 });
  }
  // Otherwise index is already the phantom (or beyond) — nothing to move to.
}

function moveToPrevCell(index) {
  if (index > 0) {
    const prev = cellEditors[index - 1];
    const lastLine = prev.lastLine();
    focusEditor(prev, { line: lastLine, ch: prev.getLine(lastLine).length });
  }
  // index === 0 — this is the first cell, nothing above it.
}

function createCellElement(cell, index) {
  const { wrapper, inputArea, outputDiv, runBtn } = buildCellDom();
  wrapper.dataset.index = index;
  inputArea.value = cell.input || "";
  runBtn.onclick = () => runCell(index);

  document.getElementById("cells").appendChild(wrapper);

  const editor = CodeMirror.fromTextArea(inputArea, {
    mode: "text/x-python",
    lineNumbers: false,
    viewportMargin: Infinity,
    extraKeys: makeExtraKeys(() => index),
  });
  cellEditors[index] = editor;

  renderOutput(outputDiv, cell);
  return wrapper;
}

function createPhantomCell() {
  const { wrapper, main, inputArea, runBtn } = buildCellDom();
  wrapper.classList.add("phantom");
  runBtn.onclick = () => {};

  const placeholder = document.createElement("span");
  placeholder.className = "cell-placeholder";
  placeholder.textContent = "Type to start a new cell…";
  main.appendChild(placeholder);

  document.getElementById("cells").appendChild(wrapper);

  const editor = CodeMirror.fromTextArea(inputArea, {
    mode: "text/x-python",
    lineNumbers: false,
    viewportMargin: Infinity,
    extraKeys: makeExtraKeys(() => cellEditors.length),
  });
  phantomEditor = editor;

  function promote() {
    editor.off("change", promote);
    const index = cellEditors.length;
    wrapper.classList.remove("phantom");
    wrapper.dataset.index = index;
    placeholder.remove();
    cellEditors[index] = editor;
    editor.setOption("extraKeys", makeExtraKeys(() => index));
    runBtn.onclick = () => runCell(index);
    createPhantomCell();
  }
  editor.on("change", promote);

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

function clearCells() {
  document.getElementById("cells").innerHTML = "";
  cellEditors = [];
  phantomEditor = null;
}

function renderCells(cells) {
  clearCells();
  cells.forEach((cell, i) => createCellElement(cell, i));
  createPhantomCell();
}

async function newNotebook() {
  await window.pywebview.api.new_notebook();
  renderCells([]);
}

async function openNotebook() {
  const result = await window.pywebview.api.load_notebook();
  if (!result.ok) {
    setStatus(`Error: ${result.error}`);
    return;
  }
  renderCells(result.cells);
  setStatus(`Opened ${result.path}`);
}

function syncTexts() {
  return window.pywebview.api.set_cell_texts(cellEditors.map(e => e.getValue()));
}

function setStatus(text) {
  const status = document.getElementById("status");
  if (status) status.textContent = text;
}

async function saveNotebook() {
  await syncTexts();
  const result = await window.pywebview.api.save_notebook();
  setStatus(result.ok ? `Saved to ${result.path}` : `Error: ${result.error}`);
}

async function runAll() {
  await syncTexts();
  const results = await window.pywebview.api.run_all();
  results.forEach((cell, index) => {
    const wrapper = document.querySelector(`.cell[data-index="${index}"]`);
    renderOutput(wrapper.querySelector(".output"), cell);
  });
}

window.addEventListener("pywebviewready", () => {
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
