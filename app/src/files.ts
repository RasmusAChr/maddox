// Saving and opening notebooks: native dialogs under Tauri, a download and a
// file picker in a plain browser (used during development).
import type { AngleMode } from "./engine/giac-session";
import type { Cell } from "./notebook/notebook";
import { textToLatex } from "./notebook/lines";

const FORMAT = "maddox-notebook";
const VERSION = 1;
const EXTENSION = "maddox";

export const isTauri = "__TAURI_INTERNALS__" in window;

/** What a .maddox file holds: the cells, and settings that change results. */
/** What a .maddox file holds: the cells, settings that change results, and the graph panel. */
export type NotebookDoc = { cells: Cell[]; angle: AngleMode; graphs?: unknown };

// Each entry is {"latex": ...}: one cell, possibly several lines, plus
// "answers": "exact" | "approx" when the cell was switched with Alt+Enter, and
// "views": {line: {xmin, xmax, ymin, ymax}} for graphs zoomed or panned, and
// "sliders": {line: {a: 1.5}} for their sliders.
// "settings" and "answers" were added after version 1 shipped; readers treat
// them as optional.
export function serialize(doc: NotebookDoc): string {
  return JSON.stringify(
    { format: FORMAT, version: VERSION, settings: { angle: doc.angle }, entries: doc.cells, ...(doc.graphs ? { graphs: doc.graphs } : {}) },
    null,
    2,
  );
}

/** A file's angle mode. Files from before the setting existed were made in
 * radians (the only mode then), so they open in radians. */
export function readAngle(settings: unknown): AngleMode {
  return (settings as any)?.angle === "deg" ? "deg" : "rad";
}

/**
 * Reads saved entries: {"latex"} objects, plain strings (early autosaves),
 * and {"text"} notes from a short-lived build with separate text blocks,
 * which become cells of # text lines.
 */
export function toCells(entries: unknown[]): Cell[] {
  return entries.map((e: any): Cell => {
    if (typeof e === "string") return { latex: e };
    if (typeof e?.text === "string") return { latex: textToLatex(e.text) };
    const cell: Cell = { latex: typeof e?.latex === "string" ? e.latex : "" };
    if (e?.answers === "exact" || e?.answers === "approx") cell.answers = e.answers;
    const views = readViews(e?.views);
    if (views) cell.views = views;
    const sliders = readSliders(e?.sliders);
    if (sliders) cell.sliders = sliders;
    return cell;
  });
}

/** Saved slider values ({line: {a: 1.5}}); anything malformed is dropped. */
function readSliders(sliders: unknown): Cell["sliders"] | null {
  if (!sliders || typeof sliders !== "object") return null;
  const out: NonNullable<Cell["sliders"]> = {};
  for (const [line, values] of Object.entries(sliders as Record<string, any>)) {
    if (!/^\d+$/.test(line) || !values || typeof values !== "object") continue;
    const kept = Object.fromEntries(Object.entries(values).filter(([n, v]) => /^[A-Za-z][A-Za-z0-9_]*$/.test(n) && Number.isFinite(v))) as Record<string, number>;
    if (Object.keys(kept).length) out[Number(line)] = kept;
  }
  return Object.keys(out).length ? out : null;
}

/** Saved graph views ({line: {xmin, xmax, ymin, ymax}}); anything malformed is dropped. */
function readViews(views: unknown): Cell["views"] | null {
  if (!views || typeof views !== "object") return null;
  const out: NonNullable<Cell["views"]> = {};
  for (const [line, v] of Object.entries(views as Record<string, any>)) {
    const ok = ["xmin", "xmax", "ymin", "ymax"].every((k) => Number.isFinite(v?.[k])) && v.xmin < v.xmax && v.ymin < v.ymax;
    if (ok && /^\d+$/.test(line)) out[Number(line)] = { xmin: v.xmin, xmax: v.xmax, ymin: v.ymin, ymax: v.ymax };
  }
  return Object.keys(out).length ? out : null;
}

export function parse(text: string): NotebookDoc {
  let data: any;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("This is not a Maddox notebook (it is not valid JSON)");
  }
  if (data?.format !== FORMAT || !Array.isArray(data.entries)) throw new Error("This is not a Maddox notebook");
  if (data.version > VERSION) throw new Error("This notebook was made by a newer version of Maddox");
  return { cells: toCells(data.entries), angle: readAngle(data.settings), graphs: data.graphs };
}

export function fileName(path: string | null): string {
  if (!path) return "Untitled";
  return path.split(/[\\/]/).pop()!.replace(new RegExp(`\\.${EXTENSION}$`), "");
}

/** Returns the path written to, or null if the user cancelled. */
export async function saveNotebook(doc: NotebookDoc, path: string | null): Promise<string | null> {
  const text = serialize(doc);
  if (isTauri) {
    const { save } = await import("@tauri-apps/plugin-dialog");
    const { writeTextFile } = await import("@tauri-apps/plugin-fs");
    const target = path ?? (await save({ filters: [{ name: "Maddox notebook", extensions: [EXTENSION] }], defaultPath: `Untitled.${EXTENSION}` }));
    if (!target) return null;
    await writeTextFile(target, text);
    return target;
  }
  const name = `${fileName(path)}.${EXTENSION}`;
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
  return name;
}

/** Reads a notebook by path (desktop app only): a recent file, or one the app was launched with. */
export async function readNotebookAt(path: string): Promise<NotebookDoc> {
  const { readTextFile } = await import("@tauri-apps/plugin-fs");
  return parse(await readTextFile(path));
}

/** The .maddox file the desktop app was started with (double-click in the file manager), if any. */
export async function launchFile(): Promise<string | null> {
  if (!isTauri) return null;
  const { invoke } = await import("@tauri-apps/api/core");
  return (await invoke<string | null>("launch_file")) ?? null;
}

export async function openNotebook(): Promise<{ doc: NotebookDoc; path: string } | null> {
  if (isTauri) {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const { readTextFile } = await import("@tauri-apps/plugin-fs");
    const path = await open({ multiple: false, directory: false, filters: [{ name: "Maddox notebook", extensions: [EXTENSION] }] });
    if (typeof path !== "string") return null;
    return { doc: parse(await readTextFile(path)), path };
  }
  const file = await new Promise<File | null>((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = `.${EXTENSION},application/json`;
    input.onchange = () => resolve(input.files?.[0] ?? null);
    input.oncancel = () => resolve(null);
    input.click();
  });
  if (!file) return null;
  return { doc: parse(await file.text()), path: file.name };
}

export async function setWindowTitle(title: string) {
  document.title = title;
  if (!isTauri) return;
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  await getCurrentWindow().setTitle(title);
}
