import "mathlive/fonts.css";
import "mathlive/static.css";
import "./style.css";
import { MathfieldElement } from "mathlive";
import { Engine, type EngineStatus } from "./engine/engine";
import type { AngleMode, AnswerMode, SolveStyle } from "./engine/giac-session";
import { fileName, isTauri, launchFile, openNotebook, readAngle, readNotebookAt, saveNotebook, setWindowTitle, toCells, type NotebookDoc } from "./files";
import { clearRecentFiles, forgetFile, recentFiles, rememberFile } from "./recent";
import { applyTheme, DIGIT_CHOICES, prefs, setPref, type Theme } from "./settings";
import { openSettings, type Setting } from "./ui/settings-dialog";
import { Notebook, type Context } from "./notebook/notebook";
import { plotItemsFromLine } from "./notebook/plot-items";
import { GraphPanel } from "./ui/graph-panel";
import { CATALOG, CATEGORIES, type CatalogItem } from "./ui/commands";
import { askUnsaved, askUpdate, openAbout, openHelp, openMatrixDialog, openSearch, type SearchItem } from "./ui/dialogs";
import { renderTemplates, toggleTemplates } from "./ui/templates";
import { appVersion, canUpdate, checkForUpdate, type Update } from "./updates";
import { applyZoom, zoom, zoomLevel } from "./zoom";

// Fonts come from mathlive/fonts.css above, bundled by Vite.
MathfieldElement.fontsDirectory = null;
MathfieldElement.soundsDirectory = null;
MathfieldElement.keypressSound = null;
MathfieldElement.plonkSound = null;

const $ = <T extends HTMLElement>(sel: string) => document.querySelector<T>(sel)!;

const engine = new Engine(new URL("giac/giacwasm.js", document.baseURI).href);
const notebook = new Notebook($("#sheet"), engine);
const panel = new GraphPanel($("#graph-panel"), engine, (mf) => {
  notebook.configure(mf);
  notebook.suggestIn(mf);
});
void applyZoom();

// Room to scroll the last cell up off the bottom edge, but only once the
// sheet is taller than the window: a notebook that fits gets no scrollbar.
// With "keep the current cell centred", once it reaches below the middle
// (a cell there must be able to scroll up to the middle).
const fitRoom = (() => {
  const scroller = $("#notebook");
  const sheet = $("#sheet");
  const fit = () => {
    // 28: the sheet's bottom margin when not tall (style.css).
    const needed = sheet.offsetHeight + parseFloat(getComputedStyle(sheet).marginTop) + 28;
    const limit = prefs.centreCell ? scroller.clientHeight / 2 : scroller.clientHeight;
    const tall = needed > limit;
    if (tall === scroller.classList.contains("tall")) return;
    scroller.classList.toggle("tall", tall);
    // A centring scroll asked for before there was room fell short; redo it.
    if (tall) requestAnimationFrame(() => notebook.recentre());
  };
  const observer = new ResizeObserver(fit);
  observer.observe(sheet);
  observer.observe(scroller);
  return fit;
})();

// ---- document state -----------------------------------------------------------

const SESSION_KEY = "maddox.session";
let path: string | null = null;
let dirty = false;
// The content as last saved or opened. MathLive reports an edit a moment
// after the keystroke, so `dirty` alone can lag: a Ctrl+N right after typing
// would discard the edit unasked. Comparing the content cannot lag.
let savedContent: string | null = null;
/** Everything saved in the file except the angle: the cells and the graph panel. */
const content = () => ({ cells: notebook.cells, graphs: panel.saved });
const currentContent = () => JSON.stringify(content());

// Degrees or radians, saved in each notebook. A new notebook starts in the
// mode last used (degrees the very first time).
const ANGLE_KEY = "maddox.angle";
let angle: AngleMode = lastAngle();
let savedAngle: AngleMode = angle;

function lastAngle(): AngleMode {
  try {
    return localStorage.getItem(ANGLE_KEY) === "rad" ? "rad" : "deg";
  } catch {
    return "deg";
  }
}

const hasUnsavedChanges = () => dirty || currentContent() !== savedContent || angle !== savedAngle;

/** What the autosave keeps between runs. */
const sessionRecord = (saved: ReturnType<typeof content>, isDirty: boolean, mode: AngleMode) =>
  JSON.stringify({ entries: saved.cells, graphs: saved.graphs, path, dirty: isDirty, angle: mode });

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
      localStorage.setItem(SESSION_KEY, sessionRecord(content(), dirty, angle));
    } catch {
      // Storage can be unavailable; autosave is only a convenience.
    }
  }, 400);
}

/** onlyIfUnsaved: "Reopen last notebook" is off, but unsaved work is never dropped. */
function restoreSession(onlyIfUnsaved = false): boolean {
  try {
    const saved = JSON.parse(localStorage.getItem(SESSION_KEY) ?? "null");
    const entries = saved?.entries ?? saved?.blocks;
    if (!Array.isArray(entries)) return false;
    if (onlyIfUnsaved && !saved.dirty) return false;
    notebook.load(toCells(entries));
    panel.load(saved.graphs);
    path = saved.path ?? null;
    dirty = Boolean(saved.dirty);
    savedContent = dirty ? null : currentContent();
    // Sessions saved before the setting existed keep the default.
    setAngle(saved.angle === undefined ? angle : readAngle(saved));
    savedAngle = angle;
    return true;
  } catch {
    return false;
  }
}

/** Saves the notebook (asking for a name when it has none); true once it is on disk. */
async function save(saveAs = false): Promise<boolean> {
  try {
    const written = await saveNotebook({ cells: notebook.cells, angle, graphs: panel.saved }, saveAs ? null : path);
    if (!written) return false;
    path = written;
    dirty = false;
    savedContent = currentContent();
    savedAngle = angle;
    updateTitle();
    markDirtyFree();
    if (isTauri) rememberFile(written);
    showMessage(`Saved ${fileName(path)}`);
    return true;
  } catch (err) {
    showMessage(`Could not save: ${err}`);
    return false;
  }
}

function markDirtyFree() {
  try {
    localStorage.setItem(SESSION_KEY, sessionRecord(content(), false, angle));
  } catch {
    // see markDirty
  }
}

/**
 * Before the notebook is replaced or the window closes: with unsaved
 * changes, ask "Save changes?". True when it is fine to go on (saved, or
 * the user chose not to save); false when they cancelled or the save did not
 * happen.
 */
async function confirmDiscard(): Promise<boolean> {
  if (!hasUnsavedChanges()) return true;
  const dialog = $<HTMLDialogElement>("#unsaved-dialog");
  if (dialog.open) return false; // already asking (e.g. a second close request)
  const choice = await askUnsaved(dialog, fileName(path));
  if (choice === "cancel") return false;
  if (choice === "discard") {
    forgetUnsavedEdits();
    return true;
  }
  return save();
}

/**
 * "Don't save" means the edits are gone: point the autosaved session back at
 * the last saved content, so they don't reappear at the next start.
 */
function forgetUnsavedEdits() {
  clearTimeout(autosaveTimer);
  try {
    if (savedContent === null) localStorage.removeItem(SESSION_KEY);
    else localStorage.setItem(SESSION_KEY, sessionRecord(JSON.parse(savedContent), false, savedAngle));
  } catch {
    // see markDirty
  }
}

function loadDocument(doc: NotebookDoc, newPath: string | null) {
  notebook.load(doc.cells);
  panel.load(doc.graphs);
  path = newPath;
  dirty = false;
  savedContent = currentContent();
  setAngle(doc.angle); // before runAll below: the engine runs requests in order
  savedAngle = doc.angle;
  updateTitle();
  markDirtyFree();
  if (isTauri && newPath) rememberFile(newPath);
  notebook.focusLast();
  void notebook.runAll();
}

async function open() {
  if (!(await confirmDiscard())) return refocus();
  try {
    const doc = await openNotebook();
    if (!doc) return refocus();
    loadDocument(doc.doc, doc.path);
  } catch (err) {
    showMessage(`Could not open: ${err instanceof Error ? err.message : err}`);
  }
}

/** Opens a notebook by path: a recent file, or the one the app was launched with. */
async function openPath(filePath: string) {
  if (!(await confirmDiscard())) return refocus();
  try {
    loadDocument(await readNotebookAt(filePath), filePath);
  } catch (err) {
    forgetFile(filePath);
    showMessage(`Could not open ${fileName(filePath)} (${err instanceof Error ? err.message : err}); removed it from recent files`);
    refocus();
  }
}

async function newNotebook() {
  if (!(await confirmDiscard())) return refocus();
  loadDocument({ cells: [], angle: lastAngle() }, null);
}

// ---- settings -----------------------------------------------------------------------

// Preferences of this computer (settings.ts); the angle mode belongs to the
// notebook. Settings that change answers re-run the notebook at once.
applyTheme();
void engine.configure({ solveStyle: prefs.solveStyle, digits: prefs.digits, answerMode: prefs.answerMode });
notebook.answerMode = prefs.answerMode;

function setAnswerPref<K extends "solveStyle" | "digits" | "answerMode">(key: K, value: (typeof prefs)[K]) {
  setPref(key, value);
  void engine.configure({ [key]: value });
  notebook.answerMode = prefs.answerMode;
  void notebook.runAll();
}

function toggleSolveStyle() {
  setAnswerPref("solveStyle", prefs.solveStyle === "textbook" ? "sets" : "textbook");
}

function settingsList(): Setting[] {
  return [
    {
      kind: "choice", id: "angle", section: "Notebook", label: "Angles",
      hint: "For sin, cos, tan and their inverses. Saved in this notebook; Ctrl+Shift+A",
      options: [{ value: "deg", label: "Degrees" }, { value: "rad", label: "Radians" }],
      get: () => angle,
      set: (v) => v !== angle && toggleAngle(),
    },
    {
      kind: "choice", id: "answer-mode", section: "Answers", label: "Answers",
      hint: "Exact answers, decimals, or both",
      options: [{ value: "auto", label: "Exact + decimal" }, { value: "exact", label: "Exact only" }, { value: "approx", label: "Decimals only" }],
      get: () => prefs.answerMode,
      set: (v) => setAnswerPref("answerMode", v as AnswerMode),
    },
    {
      kind: "choice", id: "solve-style", section: "Answers", label: "Solve answers",
      options: [{ value: "textbook", label: "x = 2 or x = 3" }, { value: "sets", label: "x ∈ {2, 3}" }],
      get: () => prefs.solveStyle,
      set: (v) => setAnswerPref("solveStyle", v as SolveStyle),
    },
    {
      kind: "choice", id: "digits", section: "Answers", label: "Decimal digits",
      hint: "Significant digits; approx(…, n) still gives n",
      options: DIGIT_CHOICES.map((d) => ({ value: String(d), label: String(d) })),
      get: () => String(prefs.digits),
      set: (v) => setAnswerPref("digits", Number(v)),
    },
    {
      kind: "choice", id: "theme", section: "Appearance", label: "Theme",
      options: [{ value: "system", label: "System" }, { value: "light", label: "Light" }, { value: "dark", label: "Dark" }],
      get: () => prefs.theme,
      set: (v) => {
        setPref("theme", v as Theme);
        applyTheme();
      },
    },
    {
      kind: "choice", id: "centre", section: "Appearance", label: "Keep the current cell centred",
      hint: "Scrolls when the cell you work in is below the middle",
      options: [{ value: "on", label: "On" }, { value: "off", label: "Off" }],
      get: () => (prefs.centreCell ? "on" : "off"),
      set: (v) => {
        setPref("centreCell", v === "on");
        notebook.centreCell = prefs.centreCell;
        fitRoom();
      },
    },
    {
      kind: "stepper", id: "zoom", section: "Appearance", label: "Zoom", hint: "Ctrl + / Ctrl − / Ctrl 0",
      display: () => `${Math.round(zoomLevel() * 100)}%`,
      step: async (dir) => {
        await zoom(dir);
        requestAnimationFrame(() => notebook.relayout());
      },
    },
    {
      kind: "choice", id: "reopen", section: "Startup & updates", label: "Reopen last notebook",
      hint: "Off starts empty; unsaved work is always restored",
      options: [{ value: "on", label: "On" }, { value: "off", label: "Off" }],
      get: () => (prefs.reopenLast ? "on" : "off"),
      set: (v) => setPref("reopenLast", v === "on"),
    },
    {
      kind: "action", id: "recent", section: "Startup & updates", label: "Recent files",
      hint: isTauri ? "The list behind Ctrl+Shift+O" : "Kept in the desktop app",
      button: () => (recentFiles().length ? `Clear ${recentFiles().length}` : "Empty"),
      enabled: () => recentFiles().length > 0,
      run: clearRecentFiles,
    },
    {
      kind: "choice", id: "check-updates", section: "Startup & updates", label: "Check for updates",
      hint: "At startup and once a day; nothing installs without asking",
      options: [{ value: "on", label: "On" }, { value: "off", label: "Off" }],
      get: () => (prefs.checkUpdates ? "on" : "off"),
      set: (v) => setPref("checkUpdates", v === "on"),
    },
    {
      kind: "action", id: "version", section: "Startup & updates", label: `Maddox ${appVersion}`,
      hint: canUpdate ? "Ctrl+P: Check for updates" : "Updates come with the desktop app",
      button: () => (update ? `Install ${update.version}` : "Check now"),
      enabled: () => canUpdate,
      run: () => {
        // The update dialog replaces settings (one dialog at a time).
        $<HTMLDialogElement>("#settings-dialog").close();
        setTimeout(() => (update ? void offerUpdate() : void lookForUpdate(true)));
      },
    },
  ];
}

/** Ctrl+, or the gear button. */
function settings() {
  openSettings($("#settings-dialog"), settingsList(), refocus);
}

// ---- angle mode -------------------------------------------------------------------

/** Applies a mode to the engine and the status-bar chip (no re-run, no save). */
function setAngle(mode: AngleMode) {
  angle = mode;
  void engine.setAngle(mode);
  const chip = $("#angle-chip");
  chip.textContent = mode === "deg" ? "DEG" : "RAD";
  chip.title = `Angles in ${mode === "deg" ? "degrees" : "radians"}: click or Ctrl+Shift+A to switch`;
  chip.setAttribute("aria-label", chip.title);
}

/** Ctrl+Shift+A or the chip: switch mode, remember it, and re-run everything. */
function toggleAngle() {
  setAngle(angle === "deg" ? "rad" : "deg");
  try {
    localStorage.setItem(ANGLE_KEY, angle);
  } catch {
    // Only a convenience: the notebook itself records its mode.
  }
  markDirty();
  void notebook.runAll();
}

// ---- updates ----------------------------------------------------------------------

// A newer version found by the last check: the status bar shows ↑ 0.2.0, and
// Ctrl+P lists "Install Maddox 0.2.0". Installing asks the update dialog first.
let update: Update | null = null;
const DAY = 24 * 60 * 60 * 1000;

/** manual: Ctrl+P or Settings asked, so say what happened (an automatic check stays quiet). */
async function lookForUpdate(manual: boolean) {
  if (!canUpdate) return manual && showMessage("Updates come with the desktop app");
  if (manual) showMessage("Checking for updates…");
  try {
    update = await checkForUpdate();
  } catch (err) {
    if (manual) showMessage(`Could not check for updates (${err instanceof Error ? err.message : err})`);
    return;
  }
  const chip = $("#update-chip");
  chip.hidden = !update;
  if (update) {
    chip.textContent = `↑ ${update.version}`;
    chip.title = `Maddox ${update.version} is available: click, or Ctrl+P Install`;
    chip.setAttribute("aria-label", chip.title);
  }
  if (manual) {
    if (update) void offerUpdate();
    else showMessage(`Maddox ${appVersion} is the newest version`);
  } else if (update) {
    showMessage(`Maddox ${update.version} is available: Ctrl+P, Install`);
  }
}

/** The update dialog; Enter installs (after "Save changes?") and restarts. */
async function offerUpdate() {
  const offered = update;
  if (!offered) return;
  if (!(await askUpdate($("#update-dialog"), offered.version, appVersion, offered.notes))) return refocus();
  if (!(await confirmDiscard())) return refocus();
  const downloading = `Downloading Maddox ${offered.version}…`;
  showMessage(downloading);
  try {
    await offered.install((fraction) => showMessage(fraction === null ? downloading : `${downloading} ${Math.round(fraction * 100)}%`));
    showMessage(`Maddox ${offered.version} is installed; restarting…`);
  } catch (err) {
    showMessage(`Could not install the update (${err instanceof Error ? err.message : err})`);
  }
  refocus();
}

// ---- status bar -----------------------------------------------------------------

const STATUS_TEXT: Record<EngineStatus, string> = {
  loading: "Loading engine…",
  ready: "Ready",
  busy: "Computing… Esc cancels",
  failed: "Engine failed to load",
};

// data-status is the engine's true state (tests and Esc rely on it). What is
// shown waits ~300 ms before saying "Computing…", so re-running a notebook,
// which flips busy/ready per cell in milliseconds, doesn't flicker.
let busyTimer: number | undefined;
engine.onStatus = (status) => {
  const el = $("#engine-status");
  el.dataset.status = status;
  el.title = status === "failed" ? engine.error ?? "" : "";
  const show = () => {
    el.dataset.shown = status;
    el.textContent = STATUS_TEXT[status];
  };
  clearTimeout(busyTimer);
  if (status === "busy") busyTimer = window.setTimeout(show, 300);
  else show();
};

const HINTS = "<kbd>Enter</kbd> evaluate · <kbd>Shift ↵</kbd> new line · <kbd>#</kbd> heading · <kbd>Ctrl P</kbd> search · <kbd>F1</kbd> all shortcuts";
/** Ctrl+Shift+G: what the caret's line defines or plots goes to the open graph tab. */
function addLineToGraph() {
  const items = plotItemsFromLine(notebook.currentLine() ?? "");
  if (!items.length) return showMessage("Nothing to plot on this line");
  panel.addItems(items);
  showMessage(`Added to the graph: ${items.length} item${items.length === 1 ? "" : "s"}`);
}

function showContext(ctx: Context) {
  const hints = $("#hints");
  if (ctx.list) {
    hints.innerHTML = `<b>Graph list</b> · type f, D or x² · <kbd>Enter</kbd> new row · <kbd>Alt ↓</kbd> sliders · <kbd>↓</kbd> into the graph · <kbd>Ctrl ↵</kbd> new tab · <kbd>Ctrl PgUp</kbd><kbd>PgDn</kbd> switch · <kbd>F2</kbd> rename · <kbd>F6</kbd> notebook`;
    hints.classList.add("in-matrix");
  } else if (ctx.graph) {
    hints.innerHTML = `<b>Graph</b> · <kbd>←</kbd><kbd>→</kbd> trace · <kbd>↑</kbd><kbd>↓</kbd> curve · <kbd>Tab</kbd> zeros, max/min · <kbd>S</kbd> sliders · <kbd>+</kbd><kbd>−</kbd> zoom · <kbd>Ctrl</kbd>+arrows pan · <kbd>0</kbd> reset · <kbd>Esc</kbd> back`;
    hints.classList.add("in-matrix");
  } else if (ctx.unit) {
    hints.innerHTML = `<b>Unit</b> · type m, km/h, kg*m/s^2 · <kbd>Space</kbd> or <kbd>Ctrl U</kbd> done · <kbd>-></kbd> then <kbd>Ctrl U</kbd> converts`;
    hints.classList.add("in-matrix");
  } else if (ctx.matrix?.cases) {
    const n = ctx.matrix.rows;
    hints.innerHTML = `<b>Piecewise, ${n} case${n === 1 ? "" : "s"}</b> · <kbd>Tab</kbd> next box · <kbd>Alt ↓</kbd><kbd>Alt ↑</kbd> add case · <kbd>Alt ⇧ ↓</kbd> delete case · type <b>otherwise</b> for the rest`;
    hints.classList.add("in-matrix");
  } else if (ctx.matrix) {
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
notebook.centreCell = prefs.centreCell;
notebook.onEvaluated = () => panel.refresh();
panel.onChange = markDirty;
panel.onExit = () => notebook.refocus();
panel.onContext = (graph) => showContext({ matrix: null, unit: false, graph, list: !graph });
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

/** Ctrl+Shift+O: the search, listing only recent files. */
function openRecent() {
  if (!recentFiles().length) {
    showMessage(isTauri ? "No recent files yet: open or save a notebook first" : "Recent files are kept in the desktop app");
    return;
  }
  openSearch($("#search-dialog"), recentItems(), refocus);
}

function recentItems(): SearchItem[] {
  return recentFiles().map((filePath) => ({
    label: fileName(filePath),
    description: filePath,
    keywords: "recent open file",
    group: "Recent files",
    run: () => void openPath(filePath),
  }));
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
    action("New notebook", "Start an empty notebook", ACTIONS.new, "Ctrl+N"),
    action("Open notebook…", "Open a .maddox file", ACTIONS.open, "Ctrl+O", "load file"),
    action("Open recent…", "A notebook you opened or saved lately", openRecent, "Ctrl+Shift+O", "recent file history"),
    action("Save", "Save the notebook", ACTIONS.save, "Ctrl+S", "file"),
    action("Save as…", "Save under a new name", () => void save(true), "Ctrl+Shift+S", "file"),
    action(angle === "deg" ? "Switch to radians" : "Switch to degrees", "Angle mode for sin, cos, tan and their inverses", toggleAngle, "Ctrl+Shift+A", "angle mode degrees radians deg rad trig"),
    action(
      prefs.solveStyle === "textbook" ? "Show solve answers as sets" : "Show solve answers as equations",
      prefs.solveStyle === "textbook" ? "x ∈ {2, 3} instead of x = 2 or x = 3" : "x = 2 or x = 3 instead of x ∈ {2, 3}",
      toggleSolveStyle,
      undefined,
      "solve answers format style sets textbook equations",
    ),
    action("Type a unit", "Letters typed next are a unit (5 m/s), upright; Space ends it", () => notebook.startUnit(), "Ctrl+U", "units metre meter second km/h kg newton convert physics"),
    action("Undo", "Take back the last change, in whichever cell it was", () => notebook.undo(), "Ctrl+Z", "undo revert back restore deleted cell"),
    action("Redo", "Put back what Undo took", () => notebook.redo(), "Ctrl+Y", "redo again"),
    action("Switch this cell: exact / decimal", "Show this cell's answers in the other form, or follow the setting again", () => notebook.toggleAnswers(), "Alt+Enter", "approximate approx decimal exact numeric evalf cell answers"),
    action("Print / Save as PDF", "The notebook on paper, or as a PDF from the print dialog", print, "Ctrl+Shift+P", "print pdf export paper hand in"),
    action("Copy result", "The result of the caret's line, as plain text", () => copyResult(), "Ctrl+Shift+C", "copy clipboard result answer text export"),
    action("Copy result as LaTeX", "The result of the caret's line, for LaTeX or Overleaf", () => copyResult("latex"), undefined, "copy clipboard result latex tex overleaf export"),
    action("Settings", "Angles, answers, digits, theme, zoom, startup", settings, "Ctrl+,", "preferences options configure theme digits"),
    ...(update ? [action(`Install Maddox ${update.version}`, "Download the new version and restart", () => void offerUpdate(), undefined, "update upgrade install new version")] : []),
    action("Check for updates", `You have Maddox ${appVersion}`, () => void lookForUpdate(true), undefined, "update upgrade new version release download about"),
    action("Show or hide templates", "The template sidebar", ACTIONS.templates, "Ctrl+B", "sidebar panel"),
    action("Keyboard shortcuts", "List every shortcut", help, "F1", "help keys"),
    action("About Maddox", `Version ${appVersion}, licences, source code`, about, undefined, "about version licence license gpl giac credits source copyright"),
  ];
  return [...recentItems(), ...templates, ...actions];
}

// ---- export: print / PDF, copy a result ------------------------------------------

/**
 * Ctrl+Shift+P: the system's print dialog, which also saves a PDF. The page
 * switches to a fixed print width and the light theme first, so results and
 * their leaders are placed where they will print, then switches back.
 */
function print() {
  const root = document.documentElement;
  const theme = root.dataset.theme;
  $("#print-title").textContent = $("#doc-name").textContent ?? "";
  $("#print-date").textContent = new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
  root.classList.add("printing");
  root.dataset.theme = "light";
  (document.activeElement as HTMLElement | null)?.blur(); // no caret or selection on paper
  notebook.preparePrint(true);
  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    root.classList.remove("printing");
    if (theme) root.dataset.theme = theme;
    else delete root.dataset.theme;
    notebook.preparePrint(false);
    refocus();
  };
  window.addEventListener("afterprint", finish, { once: true });
  // If a webview never reports the dialog closing, the next key or click does.
  const later = () => setTimeout(() => {
    window.addEventListener("keydown", finish, { once: true, capture: true });
    window.addEventListener("pointerdown", finish, { once: true, capture: true });
  });
  requestAnimationFrame(() => {
    window.print();
    later();
  });
}

/** Ctrl+Shift+C: the result of the caret's line to the clipboard (Ctrl+P: as LaTeX). */
function copyResult(format: "text" | "latex" = "text") {
  const text = notebook.resultAtCaret(format);
  if (text === null) return showMessage("This line has no result to copy.");
  void writeClipboard(text).then((ok) => showMessage(ok ? `Copied: ${text}` : "Couldn't copy to the clipboard."));
}

async function writeClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Older webviews: copy from a hidden text field, then give the keyboard back.
    const area = document.createElement("textarea");
    area.value = text;
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.append(area);
    area.select();
    const ok = document.execCommand("copy");
    area.remove();
    refocus();
    return ok;
  }
}

function matrix() {
  openMatrixDialog($("#matrix-dialog"), (rows, cols) => notebook.insertMatrix(rows, cols), refocus);
}

function help() {
  openHelp($("#help-dialog"), refocus);
}

function about() {
  openAbout($("#about-dialog"), appVersion, refocus);
}

/** Inserts a catalog or template item; "Matrix…" asks for a size first. */
function useItem(item: CatalogItem) {
  if (item.latex) notebook.insert(item.latex);
  else matrix();
}

renderTemplates($("#templates"), useItem, refocus);

const ACTIONS: Record<string, () => void> = {
  templates: toggleTemplates,
  settings,
  search,
  matrix,
  help,
  "run-all": () => void notebook.runAll(),
  new: () => void newNotebook(),
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
const FOCUSABLE = "input, textarea, select, button, a[href], summary, math-field, [contenteditable='true'], .graph";
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
    // F6: the keyboard moves between the notebook and the graph panel.
    if (e.key === "F6" && panel.isOpen) return run(() => (panel.hasFocus ? notebook.refocus() : panel.focus()));
    if (mod && !e.altKey && key === "g") return run(() => (e.shiftKey ? addLineToGraph() : panel.toggle()));
    if (!mod || e.altKey) return;
    if (e.shiftKey && e.key === "Enter") return run(ACTIONS["run-all"]);
    if (e.shiftKey && key === "a") return run(toggleAngle);
    if (e.key === ",") return run(settings);
    if (e.shiftKey && key === "p") return run(print);
    if (e.shiftKey && key === "c") return run(() => copyResult());
    if (key === "p" || key === "k") return run(search);
    // By character, not physical key: on a Danish keyboard "+" has its own
    // key (whose code is "Minus"), on a US one it is "=".
    const zoomStep = e.key === "+" || e.key === "=" ? 1 : e.key === "-" ? -1 : e.key === "0" ? 0 : null;
    if (zoomStep !== null) {
      return run(() =>
        void zoom(zoomStep).then((level) => {
          showMessage(`Zoom ${Math.round(level * 100)}%`);
          requestAnimationFrame(() => notebook.relayout());
        }),
      );
    }
    if (key === "b") return run(ACTIONS.templates);
    if (key === "m") return run(matrix);
    if (key === "n" && !e.shiftKey) return run(ACTIONS.new);
    if (key === "o") return run(e.shiftKey ? openRecent : ACTIONS.open);
    if (key === "s") return run(() => void save(e.shiftKey));
  },
  { capture: true },
);

// ---- closing ----------------------------------------------------------------------

// Never lose work silently: closing with unsaved changes asks first.
if (isTauri) {
  void import("@tauri-apps/api/window").then(({ getCurrentWindow }) =>
    getCurrentWindow().onCloseRequested(async (event) => {
      if (!(await confirmDiscard())) {
        event.preventDefault();
        refocus();
      }
    }),
  );
} else {
  // In a browser (development) the browser's own prompt is all a page gets.
  window.addEventListener("beforeunload", (e) => {
    if (hasUnsavedChanges()) e.preventDefault();
  });
}

// ---- start ----------------------------------------------------------------------

if (!restoreSession(!prefs.reopenLast)) {
  notebook.load([]);
  panel.load(null);
  savedContent = currentContent();
  setAngle(angle);
}
const angleChip = $("#angle-chip");
angleChip.addEventListener("mousedown", (e) => e.preventDefault()); // keep focus in the cell
angleChip.addEventListener("click", toggleAngle);
const updateChip = $("#update-chip");
updateChip.addEventListener("mousedown", (e) => e.preventDefault());
updateChip.addEventListener("click", () => void offerUpdate());
updateTitle();
showContext({ matrix: null, unit: false });
notebook.focusLast();
if (notebook.latexList.some((l) => l.trim())) void notebook.runAll();

// Started by double-clicking a .maddox file: open it (asking first if the
// restored session has unsaved changes).
void launchFile()
  .then((launched) => {
    if (launched) return openPath(launched);
  })
  .catch(() => {});

// A few seconds in, so starting up stays quick; then once a day while open.
if (prefs.checkUpdates) setTimeout(() => void lookForUpdate(false), 3000);
setInterval(() => prefs.checkUpdates && void lookForUpdate(false), DAY);
