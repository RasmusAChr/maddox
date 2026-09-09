let cellEditors = [];
let phantomEditor = null;
let activeEditor = null;

// Snippets use "|" to mark where the cursor lands after insertion.
const TEMPLATES = [
  { category: "Assign", items: [
    { label: "Assign variable", snippet: "x := |" },
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

  return { wrapper, main, inputArea, outputDiv, runBtn };
}

// getIndex() returns this editor's current cell index — a fixed number for
// a real cell, or cellEditors.length (its prospective index) for the
// not-yet-promoted phantom cell.
function makeExtraKeys(getIndex) {
  return {
    "Ctrl-Enter": () => {
      const i = getIndex();
      if (i < cellEditors.length) {
        runCell(i);
      } else if (i === cellEditors.length) {
        const promoted = promotePhantom();
        if (promoted !== null) runCell(promoted);
      }
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
  if (index === cellEditors.length) {
    // We're in the phantom cell — Enter here promotes it (if it has
    // content) into a real cell, then moves into the freshly created
    // phantom that follows it. An empty phantom has nothing to commit.
    const promotedIndex = promotePhantom();
    if (promotedIndex !== null) {
      focusEditor(phantomEditor, { line: 0, ch: 0 });
    }
    return;
  }
  const nextIndex = index + 1;
  if (nextIndex < cellEditors.length) {
    focusEditor(cellEditors[nextIndex], { line: 0, ch: 0 });
  } else if (phantomEditor) {
    focusEditor(phantomEditor, { line: 0, ch: 0 });
  }
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
    scrollbarStyle: "null",
    extraKeys: makeExtraKeys(() => index),
  });
  cellEditors[index] = editor;
  editor.refresh();
  editor.on("focus", () => { activeEditor = editor; });

  renderOutput(outputDiv, cell);
  return wrapper;
}

function createPhantomCell() {
  const { wrapper, main, inputArea, runBtn } = buildCellDom();
  wrapper.classList.add("phantom");
  runBtn.onclick = () => {
    const promoted = promotePhantom();
    if (promoted !== null) runCell(promoted);
  };

  const placeholder = document.createElement("span");
  placeholder.className = "cell-placeholder";
  placeholder.textContent = "Type to start a new cell…";
  main.appendChild(placeholder);

  document.getElementById("cells").appendChild(wrapper);

  const editor = CodeMirror.fromTextArea(inputArea, {
    mode: "text/x-python",
    lineNumbers: false,
    viewportMargin: Infinity,
    scrollbarStyle: "null",
    extraKeys: makeExtraKeys(() => cellEditors.length),
  });
  phantomEditor = editor;
  editor.refresh();
  editor.on("focus", () => { activeEditor = editor; });

  // Typing alone does not create a cell — only committing via Enter or
  // Ctrl-Enter (see promotePhantom) does. This just keeps the "type to
  // start a new cell" placeholder in sync with whether there's a draft.
  editor.on("change", () => {
    placeholder.hidden = editor.getValue().length > 0;
  });

  wrapper._placeholder = placeholder;
  wrapper._runBtn = runBtn;
  return wrapper;
}

// Turns the current phantom cell into a real cell, if it has any content.
// Returns the new cell's index, or null if there was nothing to promote.
function promotePhantom() {
  if (!phantomEditor || !phantomEditor.getValue().trim()) return null;
  const editor = phantomEditor;
  const wrapper = editor.getWrapperElement().closest(".cell");
  const index = cellEditors.length;

  wrapper.classList.remove("phantom");
  wrapper.dataset.index = index;
  wrapper._placeholder.remove();
  cellEditors[index] = editor;
  editor.setOption("extraKeys", makeExtraKeys(() => index));
  wrapper._runBtn.onclick = () => runCell(index);

  createPhantomCell();
  return index;
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
  activeEditor = null;
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

function insertTemplate(snippet) {
  const editor = activeEditor || phantomEditor;
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
