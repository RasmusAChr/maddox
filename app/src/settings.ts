// Preferences of this computer (localStorage). The angle mode is not here:
// it belongs to each notebook and is saved in its file. Zoom keeps its own
// key in zoom.ts.
import type { AnswerMode, SolveStyle } from "./engine/giac-session";

export type Theme = "system" | "light" | "dark";

export type Prefs = {
  solveStyle: SolveStyle;
  /** Significant digits for decimal answers. */
  digits: number;
  answerMode: AnswerMode;
  theme: Theme;
  /** Start with the last notebook (on) or an empty one (off). */
  reopenLast: boolean;
};

export const DIGIT_CHOICES = [4, 6, 8, 10, 12];

const KEY = "maddox.prefs";
const DEFAULTS: Prefs = { solveStyle: "textbook", digits: 6, answerMode: "auto", theme: "system", reopenLast: true };

function load(): Prefs {
  const prefs = { ...DEFAULTS };
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? "{}");
    // Before this store existed the solve style had a key of its own.
    if (localStorage.getItem("maddox.solve-style") === "sets") prefs.solveStyle = "sets";
    if (saved.solveStyle === "sets" || saved.solveStyle === "textbook") prefs.solveStyle = saved.solveStyle;
    if (DIGIT_CHOICES.includes(saved.digits)) prefs.digits = saved.digits;
    if (["auto", "exact", "approx"].includes(saved.answerMode)) prefs.answerMode = saved.answerMode;
    if (["system", "light", "dark"].includes(saved.theme)) prefs.theme = saved.theme;
    if (typeof saved.reopenLast === "boolean") prefs.reopenLast = saved.reopenLast;
  } catch {
    // defaults
  }
  return prefs;
}

export const prefs: Prefs = load();

export function setPref<K extends keyof Prefs>(key: K, value: Prefs[K]) {
  prefs[key] = value;
  try {
    localStorage.setItem(KEY, JSON.stringify(prefs));
  } catch {
    // Only for this run, then.
  }
}

/** System follows Windows / the desktop; Light and Dark override it. */
export function applyTheme(theme: Theme = prefs.theme) {
  if (theme === "system") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = theme;
}
