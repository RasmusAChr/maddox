let cellEditors = [];

function createCellElement(cell, index) {
  const wrapper = document.createElement("div");
  wrapper.className = "cell";
  wrapper.dataset.index = index;

  const inputArea = document.createElement("textarea");
  inputArea.value = cell.input || "";
  wrapper.appendChild(inputArea);

  const runBtn = document.createElement("button");
  runBtn.textContent = "Run";
  runBtn.onclick = () => runCell(index);
  wrapper.appendChild(runBtn);

  const outputDiv = document.createElement("div");
  outputDiv.className = "output";
  wrapper.appendChild(outputDiv);

  document.getElementById("cells").appendChild(wrapper);

  const editor = CodeMirror.fromTextArea(inputArea, {
    mode: "text/x-python",
    lineNumbers: false,
    viewportMargin: Infinity,
  });
  cellEditors[index] = editor;

  renderOutput(outputDiv, cell);
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

function addCell() {
  const index = cellEditors.length;
  createCellElement({ input: "", output_latex: null, error: null }, index);
}

function clearCells() {
  document.getElementById("cells").innerHTML = "";
  cellEditors = [];
}

async function newNotebook() {
  await window.pywebview.api.new_notebook();
  clearCells();
  addCell();
}

async function openNotebook() {
  const result = await window.pywebview.api.load_notebook();
  if (!result.ok) return;
  clearCells();
  result.cells.forEach((cell, i) => createCellElement(cell, i));
  if (result.cells.length === 0) addCell();
}

async function saveNotebook() {
  await window.pywebview.api.save_notebook();
}

window.addEventListener("pywebviewready", () => {
  document.getElementById("new-btn").onclick = newNotebook;
  document.getElementById("open-btn").onclick = openNotebook;
  document.getElementById("save-btn").onclick = saveNotebook;
  document.getElementById("add-cell-btn").onclick = addCell;
  addCell();
});
