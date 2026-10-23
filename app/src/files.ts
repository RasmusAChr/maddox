// Saving and opening notebooks: native dialogs under Tauri, a download and a
// file picker in a plain browser (used during development).
import { textToLatex } from "./notebook/lines";

const FORMAT = "maddox-notebook";
const VERSION = 1;
const EXTENSION = "maddox";

export const isTauri = "__TAURI_INTERNALS__" in window;

// Each entry is {"latex": ...}: one cell, possibly several lines.
export function serialize(cells: string[]): string {
  return JSON.stringify({ format: FORMAT, version: VERSION, entries: cells.map((latex) => ({ latex })) }, null, 2);
}

/**
 * Reads saved entries: {"latex"} objects, plain strings (early autosaves),
 * and {"text"} notes from a short-lived build with separate text blocks,
 * which become cells of # text lines.
 */
export function toCells(entries: unknown[]): string[] {
  return entries.map((e: any) => {
    if (typeof e === "string") return e;
    if (typeof e?.latex === "string") return e.latex;
    if (typeof e?.text === "string") return textToLatex(e.text);
    return "";
  });
}

export function parse(text: string): string[] {
  let data: any;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("This is not a Maddox notebook (it is not valid JSON)");
  }
  if (data?.format !== FORMAT || !Array.isArray(data.entries)) throw new Error("This is not a Maddox notebook");
  if (data.version > VERSION) throw new Error("This notebook was made by a newer version of Maddox");
  return toCells(data.entries);
}

export function fileName(path: string | null): string {
  if (!path) return "Untitled";
  return path.split(/[\\/]/).pop()!.replace(new RegExp(`\\.${EXTENSION}$`), "");
}

/** Returns the path written to, or null if the user cancelled. */
export async function saveNotebook(cells: string[], path: string | null): Promise<string | null> {
  const text = serialize(cells);
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
export async function readNotebookAt(path: string): Promise<string[]> {
  const { readTextFile } = await import("@tauri-apps/plugin-fs");
  return parse(await readTextFile(path));
}

/** The .maddox file the desktop app was started with (double-click in the file manager), if any. */
export async function launchFile(): Promise<string | null> {
  if (!isTauri) return null;
  const { invoke } = await import("@tauri-apps/api/core");
  return (await invoke<string | null>("launch_file")) ?? null;
}

export async function openNotebook(): Promise<{ cells: string[]; path: string } | null> {
  if (isTauri) {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const { readTextFile } = await import("@tauri-apps/plugin-fs");
    const path = await open({ multiple: false, directory: false, filters: [{ name: "Maddox notebook", extensions: [EXTENSION] }] });
    if (typeof path !== "string") return null;
    return { cells: parse(await readTextFile(path)), path };
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
  return { cells: parse(await file.text()), path: file.name };
}

export async function setWindowTitle(title: string) {
  document.title = title;
  if (!isTauri) return;
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  await getCurrentWindow().setTitle(title);
}
