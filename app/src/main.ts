import "mathlive/fonts.css";
import "mathlive/static.css";
import "./style.css";
import { MathfieldElement } from "mathlive";
import { Engine, type EngineStatus } from "./engine/engine";
import { fileName, openNotebook, saveNotebook, setWindowTitle, toCells } from "./files";
import { Notebook, type Context } from "./notebook/notebook";
import { CATALOG, CATEGORIES, type CatalogItem } from "./ui/commands";
import { openHelp, openMatrixDialog, openSearch, type SearchItem } from "./ui/dialogs";
import { renderTemplates, toggleTemplates } from "./ui/templates";

// Fonts come from mathlive/fonts.css above, bundled by Vite.
MathfieldElement.fontsDirectory = null;
MathfieldElement.soundsDirectory = null;
MathfieldElement.keypressSound = null;
MathfieldElement.plonkSound = null;

const $ = <T extends HTMLElement>(sel: string) => document.querySelector<T>(sel)!;

const engine = new Engine(new URL("giac/giacwasm.js", document.baseURI).href);
const notebook = new Notebook($("#notebook"), engine);

// ---- document state -----------------------------------------------------------

const SESSION_KEY = "maddox.session";
let path: string | null = null;
let dirty = false;

function updateTitle() {
  const name = fileName(path);
  $("#doc-name").textContent = name;
  $("#dirty").hidden = !dirty;
  void setWindowTitle(`${dirty ? "● " : ""}${name} — Maddox`);
}

let autosaveTimer: number | undefined;
function markDirty() {
  dirty = true;
  updateTitle();
  clearTimeout(autosaveTimer);
  autosaveTimer = window.setTimeout(() => {
    try {
      localStorage.setItem(SESSION_KEY, JSON.stringify({ entries: notebook.latexList, path, dirty }));
    } catch {
      // Storage can be unavailable; autosave is only a convenience.
    }
  }, 400);
}

function restoreSession(): boolean {
  try {
    const saved = JSON.parse(localStorage.getItem(SESSION_KEY) ?? "null");
    const entries = saved?.entries ?? saved?.blocks;
    if (!Array.isArray(entries)) return false;
    notebook.load(toCells(entries));
    path = saved.path ?? null;
    dirty = Boolean(saved.dirty);
    return true;
  } catch {
    return false;
  }
}

async function save(saveAs = false) {
  try {
    const written = await saveNotebook(notebook.latexList, saveAs ? null : path);
    if (!written) return;
    path = written;
    dirty = false;
    updateTitle();
    markDirtyFree();
    showMessage(`Saved ${fileName(path)}`);
  } catch (err) {
    showMessage(`Could not save: ${err}`);
  }
}

function markDirtyFree() {
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify({ entries: notebook.latexList, path, dirty: false }));
  } catch {
    // see markDirty
  }
}

async function open() {
  try {
    const doc = await openNotebook();
    if (!doc) return refocus();
    notebook.load(doc.cells);
    path = doc.path;
    dirty = false;
    updateTitle();
    markDirtyFree();
    notebook.focusLast();
    await notebook.runAll();
  } catch (err) {
    showMessage(`Could not open: ${err instanceof Error ? err.message : err}`);
  }
}

function newNotebook() {
  notebook.load([]);
  path = null;
  dirty = false;
  updateTitle();
  markDirtyFree();
  void engine.reset();
  notebook.focusLast();
}

// ---- status bar -----------------------------------------------------------------

const STATUS_TEXT: Record<EngineStatus, string> = {
  loading: "Loading engine…",
  ready: "Ready",
  busy: "Computing… Esc cancels",
  failed: "Engine failed to load",
};

engine.onStatus = (status) => {
  const el = $("#engine-status");
  el.dataset.status = status;
  el.textContent = STATUS_TEXT[status];
  el.title = status === "failed" ? engine.error ?? "" : "";
};

const HINTS = "<kbd>Enter</kbd> evaluate · <kbd>Shift ↵</kbd> new line · <kbd>#</kbd> at line start: text · <kbd>Ctrl P</kbd> search · <kbd>Ctrl M</kbd> matrix · <kbd>F1</kbd> shortcuts";
function showContext(ctx: Context) {
  const hints = $("#hints");
  if (ctx.matrix) {
    const { rows, cols } = ctx.matrix;
    hints.innerHTML = `<b>Matrix ${rows}×${cols}</b> · <kbd>Alt ↓</kbd><kbd>Alt ↑</kbd> add row · <kbd>Alt →</kbd><kbd>Alt ←</kbd> add column · <kbd>Alt ⇧ ↓</kbd> delete row · <kbd>Alt ⇧ →</kbd> delete column`;
    hints.classList.add("in-matrix");
  } else {
    hints.innerHTML = HINTS;
    hints.classList.remove("in-matrix");
  }
}

let messageTimer: number | undefined;
function showMessage(text: string) {
  const el = $("#message");
  el.textContent = text;
  clearTimeout(messageTimer);
  messageTimer = window.setTimeout(() => (el.textContent = ""), 6000);
}

notebook.onChange = markDirty;
notebook.onContext = showContext;
notebook.onMessage = showMessage;

// ---- commands -------------------------------------------------------------------

function refocus() {
  notebook.refocus();
}

/** Ctrl+P: every template and every app action, Obsidian-style. */
function search() {
  openSearch($("#search-dialog"), searchItems(), refocus);
}

function searchItems(): SearchItem[] {
  const groupName = new Map(CATEGORIES.map((c) => [c.id, c.name]));
  const templates: SearchItem[] = CATALOG.map((item) => ({
    label: item.label,
    hint: item.syntax,
    description: item.description,
    keywords: item.keywords,
    group: groupName.get(item.category) ?? item.category,
    run: () => useItem(item),
  }));
  const action = (label: string, description: string, run: () => void, shortcut?: string, keywords?: string): SearchItem => ({
    label, description, run, shortcut, keywords, group: "App",
  });
  const actions = [
    action("Run all", "Re-run every entry from the top", ACTIONS["run-all"], "Ctrl+Shift+Enter", "evaluate recalculate"),
    action("New notebook", "Start an empty notebook", newNotebook, "Ctrl+N"),
    action("Open notebook…", "Open a .maddox file", ACTIONS.open, "Ctrl+O", "load file"),
    action("Save", "Save the notebook", ACTIONS.save, "Ctrl+S", "file"),
    action("Save as…", "Save under a new name", () => void save(true), "Ctrl+Shift+S", "file"),
    action("Show or hide templates", "The template sidebar", ACTIONS.templates, "Ctrl+B", "sidebar panel"),
    action("Keyboard shortcuts", "List every shortcut", help, "F1", "help keys"),
  ];
  return [...templates, ...actions];
}

function matrix() {
  openMatrixDialog($("#matrix-dialog"), (rows, cols) => notebook.insertMatrix(rows, cols), refocus);
}

function help() {
  openHelp($("#help-dialog"), refocus);
}

/** Inserts a catalog or template item; "Matrix…" asks for a size first. */
function useItem(item: CatalogItem) {
  if (item.latex) notebook.insert(item.latex);
  else matrix();
}

renderTemplates($("#templates"), useItem, refocus);

const ACTIONS: Record<string, () => void> = {
  templates: toggleTemplates,
  search,
  matrix,
  help,
  "run-all": () => void notebook.runAll(),
  new: newNotebook,
  open: () => void open(),
  save: () => void save(),
};

for (const button of document.querySelectorAll<HTMLButtonElement>("[data-action]")) {
  // Keep focus (and the caret) in the entry when clicking toolbar buttons.
  button.addEventListener("mousedown", (e) => e.preventDefault());
  button.addEventListener("click", () => ACTIONS[button.dataset.action!]());
}

// Clicking empty space would move focus to <body> and leave the keyboard
// with nowhere to go. Only real controls take focus from a click; in the
// notebook, a click on empty space puts the caret in the entry it hit (or
// the last one), like a text editor. Clicking a result still pastes it.
const FOCUSABLE = "input, textarea, select, button, a[href], summary, math-field, [contenteditable='true']";
window.addEventListener("mousedown", (e) => {
  const target = e.target as Element;
  if (e.button !== 0 || target.closest(FOCUSABLE)) return;
  // A press on a scrollbar targets its element; leave scrolling alone.
  if (target instanceof HTMLElement && (e.offsetX >= target.clientWidth || e.offsetY >= target.clientHeight)) return;
  e.preventDefault();
  if (target.closest("#notebook") && !target.closest(".entry-result .exact")) notebook.focusFromClick(target);
});

// Capture phase: runs before MathLive sees the key.
window.addEventListener(
  "keydown",
  (e) => {
    if (document.querySelector("dialog[open]")) return;
    const mod = e.ctrlKey || e.metaKey;
    const key = e.key.toLowerCase();
    const run = (fn: () => void) => {
      e.preventDefault();
      e.stopPropagation();
      fn();
    };
    if (e.key === "Escape" && engine.isBusy) return run(() => engine.cancel());
    if (e.key === "F1" || (mod && key === "/")) return run(help);
    if (!mod || e.altKey) return;
    if (e.shiftKey && e.key === "Enter") return run(ACTIONS["run-all"]);
    if (key === "p" || key === "k") return run(search);
    if (key === "b") return run(ACTIONS.templates);
    if (key === "m") return run(matrix);
    if (key === "n" && !e.shiftKey) return run(newNotebook);
    if (key === "o") return run(ACTIONS.open);
    if (key === "s") return run(() => void save(e.shiftKey));
  },
  { capture: true },
);

// ---- start ----------------------------------------------------------------------

if (!restoreSession()) notebook.load([]);
updateTitle();
showContext({ matrix: null });
notebook.focusLast();
if (notebook.latexList.some((l) => l.trim())) void notebook.runAll();
