let cellEditors = [];
let activeEditor = null;

// Snippets use "|" to mark where the cursor lands after insertion.
const TEMPLATES = [
  { category: "Assign", items: [
    { label: "Assign variable", snippet: "x := |" },
    { label: "Clear variable", snippet: "clear(|)" },
    { label: "Clear all variables", snippet: "clear()" },
  ]},
  { category: "Algebra", items: [
    { label: "Solve equation", snippet: "solve(| = 0, x)" },
    { label: "Simplify", snippet: "simplify(|)" },
    { label: "Expand", snippet: "expand(|)" },
    { label: "Factor", snippet: "factor(|)" },
    { label: "Substitute", snippet: "(|).subs(x, 2)" },
  ]},
  { category: "Calculus", items: [
    { label: "Derivative", snippet: "diff(|, x)" },
    { label: "Integral", snippet: "integrate(|, x)" },
    { label: "Definite integral", snippet: "integrate(|, (x, 0, 1))" },
    { label: "Limit", snippet: "limit(|, x, 0)" },
  ]},
  { category: "Linear algebra", items: [
    { label: "Matrix", snippet: "Matrix([[|, 0], [0, 1]])" },
    { label: "Determinant", snippet: "det(|)" },
    { label: "Inverse", snippet: "(|).inv()" },
    { label: "Transpose", snippet: "(|).T" },
    { label: "Eigenvalues", snippet: "(|).eigenvals()" },
    { label: "Linear system", snippet: "solve([| = 0, y = 0], [x, y])" },
  ]},
  { category: "Numeric", items: [
    { label: "Evaluate", snippet: "N(|)" },
    { label: "Evaluate to 10 digits", snippet: "N(|, 10)" },
  ]},
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

  const inputArea = document.createElement("textarea");
  main.appendChild(inputArea);

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

  return { wrapper, inputArea, outputDiv, runBtn };
}

// getIndex() returns this editor's current cell index; it is re-bound
// whenever cells are inserted or removed (see reindexCell).
function makeExtraKeys(getIndex) {
  return {
    "Ctrl-Enter": () => runCell(getIndex()),
    "Enter": () => insertCellAfter(getIndex()),
    "Shift-Enter": "newlineAndIndent",
    "Backspace": function (cm) {
      if (cm.getValue() !== "") return CodeMirror.Pass;
      if (cellEditors.length > 1) removeCell(getIndex());
    },
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

function focusEnd(editor) {
  const lastLine = editor.lastLine();
  focusEditor(editor, { line: lastLine, ch: editor.getLine(lastLine).length });
}

function moveToNextCell(index) {
  if (index + 1 < cellEditors.length) {
    focusEditor(cellEditors[index + 1], { line: 0, ch: 0 });
  }
}

function moveToPrevCell(index) {
  if (index > 0) focusEnd(cellEditors[index - 1]);
}

function cellWrapper(editor) {
  return editor.getWrapperElement().closest(".cell");
}

function reindexCell(j) {
  const editor = cellEditors[j];
  const wrapper = cellWrapper(editor);
  wrapper.dataset.index = j;
  wrapper.querySelector(".run-btn").onclick = () => runCell(j);
  editor.setOption("extraKeys", makeExtraKeys(() => j));
}

// Creates a cell at `index`, shifting any later cells down by one.
function createCellElement(cell, index) {
  const { wrapper, inputArea, outputDiv } = buildCellDom();
  inputArea.value = cell.input || "";

  const container = document.getElementById("cells");
  const next = cellEditors[index] ? cellWrapper(cellEditors[index]) : null;
  container.insertBefore(wrapper, next);

  const editor = CodeMirror.fromTextArea(inputArea, {
    mode: "text/x-python",
    lineNumbers: false,
    viewportMargin: Infinity,
    scrollbarStyle: "null",
  });
  cellEditors.splice(index, 0, editor);
  for (let j = index; j < cellEditors.length; j++) reindexCell(j);
  editor.refresh();
  editor.on("focus", () => { activeEditor = editor; });

  renderOutput(outputDiv, cell);
  return editor;
}

function insertCellAfter(index) {
  const editor = createCellElement({ input: "", output_latex: null, error: null }, index + 1);
  syncTexts();
  focusEditor(editor, { line: 0, ch: 0 });
}

function removeCell(index) {
  const editor = cellEditors[index];
  cellWrapper(editor).remove();
  cellEditors.splice(index, 1);
  if (activeEditor === editor) activeEditor = null;
  for (let j = index; j < cellEditors.length; j++) reindexCell(j);
  syncTexts();
  if (index > 0) {
    moveToPrevCell(index);
  } else {
    focusEditor(cellEditors[0], { line: 0, ch: 0 });
  }
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
  activeEditor = null;
}

// The notebook always shows at least one cell.
function renderCells(cells) {
  clearCells();
  if (cells.length === 0) cells = [{ input: "", output_latex: null, error: null }];
  cells.forEach((cell, i) => createCellElement(cell, i));
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

function insertTemplate(snippet) {
  const editor = activeEditor || cellEditors[0];
  if (!editor) return;
  const marker = snippet.indexOf("|");
  const before = marker === -1 ? snippet : snippet.slice(0, marker);
  const after = marker === -1 ? "" : snippet.slice(marker + 1);
  const selected = editor.getSelection();
  editor.replaceSelection(before + selected + after, "start");
  const start = editor.getCursor();
  const cursor = editor.posFromIndex(
    editor.indexFromPos(start) + before.length + selected.length
  );
  editor.setCursor(cursor);
  editor.focus();
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
      btn.title = item.snippet.replace("|", "…");
      btn.onclick = () => insertTemplate(item.snippet);
      const label = document.createElement("span");
      label.textContent = item.label;
      const code = document.createElement("code");
      code.textContent = item.snippet.replace("|", "…");
      btn.appendChild(label);
      btn.appendChild(code);
      list.appendChild(btn);
    });
    details.appendChild(list);
    container.appendChild(details);
  });
}

window.addEventListener("pywebviewready", () => {
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
