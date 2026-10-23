// The notebooks opened or saved most recently, newest first. Only real file
// paths (the desktop app) are kept; a browser download has no path to reopen.

const KEY = "maddox.recent";
const MAX = 8;

export function recentFiles(): string[] {
  try {
    const list = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(list) ? list.filter((p): p is string => typeof p === "string") : [];
  } catch {
    return [];
  }
}

function store(list: string[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX)));
  } catch {
    // Only a convenience.
  }
}

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

export function rememberFile(path: string) {
  store([path, ...recentFiles().filter((p) => !same(p, path))]);
}

/** Drops a file that could not be opened (moved or deleted). */
export function forgetFile(path: string) {
  store(recentFiles().filter((p) => !same(p, path)));
}
