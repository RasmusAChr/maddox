import { inlineCode, parseNotes } from "./release-notes";
import { queryWords, score, type Searchable } from "./search";

/**
 * Shows a <dialog>; onCancel runs if it closes some other way than through
 * the returned `finish`. finish() runs its action synchronously: the "close"
 * event fires a task later, after focus is already back in the entry, and a
 * key typed in between would land before the inserted text.
 *
 * Closing is settled at once whenever we close the dialog ourselves (Esc,
 * finish). Only a close by the browser waits for the "close" event. That
 * event can arrive late: after Esc, a quick Ctrl+P reopened the search before
 * it came (Chrome handles input first). If it then ran the old opening's
 * cancel, focus left the new dialog and the typed query went nowhere.
 */
export function openDialog(dialog: HTMLDialogElement, onCancel: () => void) {
  let finished = false;
  let settled = false;
  const settle = () => {
    if (settled) return;
    settled = true;
    dialog.removeEventListener("keydown", onEscape);
    dialog.removeEventListener("close", onClose);
    if (finished) return;
    dropRestoredFocus();
    onCancel();
  };
  // Esc closes the dialog here rather than by the browser's own handling:
  // in WebKitGTK (Linux) the settings dialog ignored Esc, even though focus
  // stayed in it.
  const onEscape = (e: KeyboardEvent) => {
    if (e.key !== "Escape" || e.defaultPrevented) return;
    e.preventDefault();
    dialog.close();
    settle();
  };
  // A late "close" from an earlier opening finds the dialog open again: not ours.
  const onClose = () => {
    if (!dialog.open) settle();
  };
  dialog.addEventListener("keydown", onEscape);
  dialog.addEventListener("close", onClose);
  dialog.showModal();
  return (action: () => void) => {
    finished = true;
    dialog.close();
    settle();
    dropRestoredFocus();
    action();
    // An action that focuses nothing (Run all, Save as…): back to the notebook.
    if (!document.activeElement || document.activeElement === document.body) onCancel();
  };
}

/**
 * A closing <dialog> hands focus back to whatever had it before it opened.
 * In WebView2 (the desktop app), focus restored that way to a math-field can
 * leave Windows' text input detached: the caret blinks but typed characters
 * go nowhere, until the cell is left and re-entered. Undo the restoration so
 * the caller focuses the cell for real (the same path as moving between
 * cells, which works).
 */
function dropRestoredFocus() {
  const el = document.activeElement;
  if (el instanceof HTMLElement && el.tagName === "MATH-FIELD") el.blur();
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

// ---- unsaved changes --------------------------------------------------------

export type UnsavedChoice = "save" | "discard" | "cancel";

/**
 * "Save changes to <name>?" Enter saves (the Save button has focus), D
 * discards, Esc cancels; the buttons work too.
 */
export function askUnsaved(dialog: HTMLDialogElement, name: string): Promise<UnsavedChoice> {
  return new Promise((resolve) => {
    dialog.querySelector<HTMLElement>(".unsaved-name")!.textContent = name;
    const finish = openDialog(dialog, () => resolve("cancel"));
    const choose = (choice: UnsavedChoice) => {
      dialog.onkeydown = null;
      finish(() => resolve(choice));
    };
    for (const button of dialog.querySelectorAll<HTMLButtonElement>("button[data-choice]")) {
      button.onclick = () => choose(button.dataset.choice as UnsavedChoice);
    }
    dialog.onkeydown = (e) => {
      if (e.key.toLowerCase() === "d" && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        choose("discard");
      }
    };
    dialog.querySelector<HTMLButtonElement>('button[data-choice="save"]')!.focus();
  });
}

// ---- update -----------------------------------------------------------------

/** "Maddox 0.2.0 is available": Enter installs (true), Esc is later (false). */
export function askUpdate(dialog: HTMLDialogElement, version: string, current: string, notes: string): Promise<boolean> {
  return new Promise((resolve) => {
    dialog.querySelector(".update-version")!.textContent = version;
    dialog.querySelector(".update-current")!.textContent = current;
    const notesEl = dialog.querySelector<HTMLElement>(".update-notes")!;
    showNotes(notesEl, notes);
    notesEl.hidden = !notes.trim();
    const finish = openDialog(dialog, () => resolve(false));
    for (const button of dialog.querySelectorAll<HTMLButtonElement>("button[data-choice]")) {
      button.onclick = () => finish(() => resolve(button.dataset.choice === "install"));
    }
    dialog.querySelector<HTMLButtonElement>('button[data-choice="install"]')!.focus();
  });
}

/** The release notes as headings and lists. Built from text nodes: the notes come from GitHub. */
function showNotes(el: HTMLElement, notes: string) {
  const inline = (parent: HTMLElement, text: string) =>
    inlineCode(text).forEach((part, i) => {
      if (i % 2) parent.appendChild(document.createElement("code")).textContent = part;
      else parent.append(part);
    });
  el.replaceChildren();
  for (const block of parseNotes(notes)) {
    if (block.kind === "list") {
      const list = el.appendChild(document.createElement("ul"));
      for (const item of block.items) inline(list.appendChild(document.createElement("li")), item);
    } else {
      inline(el.appendChild(document.createElement(block.kind === "heading" ? "h3" : "p")), block.text);
    }
  }
}

// ---- help -------------------------------------------------------------------

/** About Maddox: version, licences, and where the source is (GPL). */
export function openAbout(dialog: HTMLDialogElement, version: string, onClose: () => void) {
  dialog.querySelector(".about-version")!.textContent = version;
  openDialog(dialog, onClose);
  dialog.focus();
}

export function openHelp(dialog: HTMLDialogElement, onClose: () => void) {
  openDialog(dialog, onClose);
  dialog.querySelector<HTMLButtonElement>("button")?.focus();
}
