let cellEditors = [];
let activeEditor = null;

// `hint` is shown in the sidebar; `latex` is what gets inserted. `\placeholder{}`
// is a fillable box; Tab moves between them.
const TEMPLATES = [
  { category: "Assign", items: [
    { label: "Assign variable", hint: "x := …", latex: "x\\coloneq\\placeholder{}" },
    { label: "Clear variable", hint: "clear(…)", latex: "\\operatorname{clear}\\left(\\placeholder{}\\right)" },
    { label: "Clear all variables", hint: "clear()", latex: "\\operatorname{clear}\\left(\\right)" },
  ]},
  { category: "Algebra", items: [
    { label: "Solve equation", hint: "solve(… = 0, x)", latex: "\\operatorname{solve}\\left(\\placeholder{}=0,x\\right)" },
    { label: "Simplify", hint: "simplify(…)", latex: "\\operatorname{simplify}\\left(\\placeholder{}\\right)" },
    { label: "Expand", hint: "expand(…)", latex: "\\operatorname{expand}\\left(\\placeholder{}\\right)" },
    { label: "Factor", hint: "factor(…)", latex: "\\operatorname{factor}\\left(\\placeholder{}\\right)" },
    { label: "Substitute", hint: "(…).subs(x, 2)", latex: "\\left(\\placeholder{}\\right).\\operatorname{subs}\\left(x,2\\right)" },
    { label: "Fraction", hint: "a/b", latex: "\\frac{\\placeholder{}}{\\placeholder{}}" },
    { label: "Square root", hint: "sqrt(…)", latex: "\\sqrt{\\placeholder{}}" },
    { label: "Power", hint: "…^n", latex: "\\placeholder{}^{\\placeholder{}}" },
  ]},
  { category: "Calculus", items: [
    { label: "Derivative", hint: "diff(…, x)", latex: "\\operatorname{diff}\\left(\\placeholder{},x\\right)" },
    { label: "Integral", hint: "integrate(…, x)", latex: "\\operatorname{integrate}\\left(\\placeholder{},x\\right)" },
    { label: "Definite integral", hint: "integrate(…, (x, 0, 1))", latex: "\\operatorname{integrate}\\left(\\placeholder{},\\left(x,0,1\\right)\\right)" },
    { label: "Limit", hint: "limit(…, x, 0)", latex: "\\operatorname{limit}\\left(\\placeholder{},x,0\\right)" },
  ]},
  { category: "Linear algebra", items: [
    { label: "Matrix 2×2", hint: "Matrix([[a, b], [c, d]])", latex: "\\begin{pmatrix}\\placeholder{}&\\placeholder{}\\\\\\placeholder{}&\\placeholder{}\\end{pmatrix}" },
    { label: "Determinant", hint: "det(…)", latex: "\\operatorname{det}\\left(\\placeholder{}\\right)" },
    { label: "Inverse", hint: "(…).inv()", latex: "\\left(\\placeholder{}\\right).\\operatorname{inv}\\left(\\right)" },
    { label: "Transpose", hint: "(…).T", latex: "\\left(\\placeholder{}\\right).T" },
    { label: "Eigenvalues", hint: "(…).eigenvals()", latex: "\\left(\\placeholder{}\\right).\\operatorname{eigenvals}\\left(\\right)" },
    { label: "Linear system", hint: "solve([… = 0, y = 0], [x, y])", latex: "\\operatorname{solve}\\left(\\left[\\placeholder{}=0,y=0\\right],\\left[x,y\\right]\\right)" },
  ]},
  { category: "Numeric", items: [
    { label: "Evaluate", hint: "N(…)", latex: "\\operatorname{N}\\left(\\placeholder{}\\right)" },
    { label: "Evaluate to 10 digits", hint: "N(…, 10)", latex: "\\operatorname{N}\\left(\\placeholder{},10\\right)" },
  ]},
];

// "sqrt" is deliberately absent: MathLive's own "sqrt" inline shortcut builds
// the 2D radical \sqrt{#?}, which \operatorname{sqrt} would replace with flat
// upright text.
const ENGINE_FUNCTIONS = [
  "solve", "simplify", "expand", "factor", "subs", "diff", "integrate",
  "limit", "Matrix", "det", "inv", "eigenvals", "N", "clear",
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
  // MathLive binds Ctrl+Enter to addRowAfter in math mode and handles it on its
  // internal keyboard sink before our host keydown listener sees it, so inside a
  // matrix the run key would grow the matrix and then run the mutated value.
  // Drop those bindings; running the cell stays with bindCellKeys.
  mf.keybindings = mf.keybindings.filter(
    (kb) => !/^ctrl\+\[(Return|Enter)\]$/.test(kb.key)
  );
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
  // Set by the "move-out" handler below when MathLive itself detects the
  // caret is already at the field's top/bottom row and asks to leave it.
  let lastMoveOutDirection = null;

  mf.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      e.stopPropagation();
      if (e.ctrlKey) runCell(getIndex());
      else insertCellAfter(getIndex());
    } else if (e.key === "Backspace" && cellLatex(mf) === "") {
      e.preventDefault();
      if (cellEditors.length > 1) removeCell(getIndex());
    } else if (
      (e.key === "ArrowUp" || e.key === "ArrowDown") &&
      !e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey
    ) {
      // On WebKitGTK (Linux), MathLive's own boundary detection for Up/Down
      // does not reliably fire the "move-out" event below, so pressing Up/Down
      // at a field's top/bottom row silently does nothing instead of moving
      // to the previous/next cell. Left/Right and the "move-out" event itself
      // work fine there -- it's specifically vertical boundary detection that
      // doesn't. Fall back to moving cells ourselves whenever the caret
      // provably didn't move, but only if "move-out" didn't already handle it
      // (which it does on platforms where it works, e.g. Windows).
      const direction = e.key === "ArrowUp" ? "upward" : "downward";
      const positionBefore = mf.position;
      lastMoveOutDirection = null;
      requestAnimationFrame(() => {
        if (lastMoveOutDirection === direction) return;
        if (mf.position !== positionBefore) return;
        if (direction === "upward") moveToPrevCell(getIndex());
        else moveToNextCell(getIndex());
      });
    }
  });
  mf.addEventListener("move-out", (e) => {
    if (e.detail.direction === "upward") {
      lastMoveOutDirection = "upward";
      e.preventDefault();
      moveToPrevCell(getIndex());
    } else if (e.detail.direction === "downward") {
      lastMoveOutDirection = "downward";
      e.preventDefault();
      moveToNextCell(getIndex());
    }
  });
}

// activeEditor is set here as well as on the focus event, because MathLive
// dispatches focus asynchronously and templates may be inserted before it fires.
function focusStart(mf) {
  mf.focus();
  activeEditor = mf;
  mf.executeCommand("moveToMathfieldStart");
}

function focusEnd(mf) {
  mf.focus();
  activeEditor = mf;
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

function insertTemplate(item) {
  const mf = activeEditor || cellEditors[0];
  if (!mf) return;
  const selected = mf.getValue(mf.selection, "latex");
  const latex = selected
    ? item.latex.replace("\\placeholder{}", selected)
    : item.latex;
  mf.insert(latex, { focus: true, selectionMode: "placeholder" });
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
      btn.title = item.hint;
      btn.onclick = () => insertTemplate(item);
      const label = document.createElement("span");
      label.textContent = item.label;
      const code = document.createElement("code");
      code.textContent = item.hint;
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
  try {
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
  } catch (e) {
    document.getElementById("cells").textContent =
      "Math input failed to initialise: " + e;
  }
});
