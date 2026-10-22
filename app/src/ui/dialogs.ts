import { queryWords, score, type Searchable } from "./search";

/**
 * Shows a <dialog>; onCancel runs if it closes some other way than through
 * the returned `finish`. finish() runs its action synchronously: the "close"
 * event fires a task later, after focus is already back in the entry, and a
 * key typed in between would land before the inserted text.
 */
function openDialog(dialog: HTMLDialogElement, onCancel: () => void) {
  let finished = false;
  dialog.addEventListener("close", () => finished || onCancel(), { once: true });
  dialog.showModal();
  return (action: () => void) => {
    finished = true;
    dialog.close();
    action();
  };
}

// ---- search (Ctrl+P) ----------------------------------------------------------

/** Anything the search can find: a template to insert or an app action. */
export type SearchItem = Searchable & {
  /** Keyboard shortcut shown on the right, e.g. "Ctrl+S". */
  shortcut?: string;
  run: () => void;
};

export function openSearch(dialog: HTMLDialogElement, items: SearchItem[], onCancel: () => void) {
  const input = dialog.querySelector<HTMLInputElement>("input")!;
  const list = dialog.querySelector<HTMLElement>(".catalog-list")!;
  let shown: SearchItem[] = [];
  let selected = 0;

  const render = () => {
    const words = queryWords(input.value);
    shown = words.length
      ? items
          .map((item, i) => ({ item, s: score(item, words), i }))
          .filter((x) => x.s > 0)
          .sort((a, b) => b.s - a.s || a.i - b.i)
          .map((x) => x.item)
      : items;
    selected = Math.min(selected, Math.max(0, shown.length - 1));
    list.replaceChildren();
    let group = "";
    shown.forEach((item, i) => {
      if (!words.length && item.group !== group) {
        group = item.group;
        const h = document.createElement("div");
        h.className = "catalog-category";
        h.textContent = group;
        list.append(h);
      }
      const row = document.createElement("div");
      row.className = "catalog-item";
      row.setAttribute("role", "option");
      row.setAttribute("aria-selected", String(i === selected));
      row.innerHTML =
        `<span class="catalog-main"><span class="catalog-name"></span><code class="catalog-hint"></code></span>` +
        `<span class="catalog-desc"></span><span class="catalog-side"></span>`;
      row.querySelector(".catalog-name")!.textContent = item.label;
      row.querySelector(".catalog-hint")!.textContent = item.hint && item.hint !== item.label ? item.hint : "";
      row.querySelector(".catalog-desc")!.textContent = item.description;
      const side = row.querySelector<HTMLElement>(".catalog-side")!;
      if (item.shortcut) side.innerHTML = item.shortcut.split("+").map((k) => `<kbd>${k}</kbd>`).join("");
      else if (words.length) side.textContent = item.group;
      row.addEventListener("mousedown", (e) => e.preventDefault());
      row.addEventListener("click", () => pick(item));
      list.append(row);
    });
    if (!shown.length) {
      const empty = document.createElement("div");
      empty.className = "catalog-empty";
      empty.textContent = "Nothing matches";
      list.append(empty);
    }
    list.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" });
  };

  let finish: (action: () => void) => void = () => {};
  const pick = (item: SearchItem) => finish(item.run);

  input.value = "";
  selected = 0;
  input.oninput = () => {
    selected = 0;
    render();
  };
  input.onkeydown = (e) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const step = e.key === "ArrowDown" ? 1 : -1;
      selected = (selected + step + shown.length) % Math.max(1, shown.length);
      render();
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (shown[selected]) pick(shown[selected]);
    }
  };
  render();
  finish = openDialog(dialog, onCancel);
  input.focus();
}

// ---- matrix size ------------------------------------------------------------

let lastSize = { rows: 2, cols: 2 };

export function openMatrixDialog(dialog: HTMLDialogElement, onInsert: (rows: number, cols: number) => void, onCancel: () => void) {
  const [rowsInput, colsInput] = dialog.querySelectorAll<HTMLInputElement>("input");
  const preview = dialog.querySelector<HTMLElement>(".matrix-preview")!;
  let finish: (action: () => void) => void = () => {};

  const clamp = (input: HTMLInputElement) => Math.min(10, Math.max(1, Math.round(Number(input.value)) || 1));
  const render = () => {
    const rows = clamp(rowsInput);
    const cols = clamp(colsInput);
    preview.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
    preview.replaceChildren(...Array.from({ length: rows * cols }, () => document.createElement("span")));
    preview.setAttribute("aria-label", `${rows} by ${cols} matrix`);
  };

  rowsInput.value = String(lastSize.rows);
  colsInput.value = String(lastSize.cols);
  for (const input of [rowsInput, colsInput]) {
    input.oninput = render;
    input.onfocus = () => input.select();
    input.onkeydown = (e) => {
      if (e.key !== "Enter") return;
      e.preventDefault();
      lastSize = { rows: clamp(rowsInput), cols: clamp(colsInput) };
      finish(() => onInsert(lastSize.rows, lastSize.cols));
    };
  }
  render();
  finish = openDialog(dialog, onCancel);
  rowsInput.focus();
  rowsInput.select();
}

// ---- help -------------------------------------------------------------------

export function openHelp(dialog: HTMLDialogElement, onClose: () => void) {
  openDialog(dialog, onClose);
  dialog.querySelector<HTMLButtonElement>("button")?.focus();
}
