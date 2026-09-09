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

// v1 notebooks store plain engine text. MathLive's ascii-math importer reads it,
// but it spells Python's "**" as \star and wraps function names as
// \operatorname{\mathrm{f}}; neither survives the LaTeX -> engine-text trip back,
// so normalize both.
function importPlainText(mf, text) {
  mf.setValue(text.replace(/\*\*/g, "^"), { format: "ascii-math" });
  mf.value = mf.value.replace(
    /\\operatorname\{\\mathrm\{([^{}]*)\}\}/g,
    "\\operatorname{$1}"
  );
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
    importPlainText(mf, cell.input);
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
  const latex = cellLatex(cellEditors[index]);
  const cell = await window.pywebview.api.evaluate_cell(index, latex);
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
  return window.pywebview.api.set_cell_texts(cellEditors.map(cellLatex));
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
  const mf = activeEditor || cellEditors[0];
  if (!mf) return;
  mf.insert(snippet.replace("|", ""), { focus: true });
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
