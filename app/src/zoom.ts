// Ctrl+= / Ctrl+- / Ctrl+0 zoom, remembered between sessions. Under Tauri it
// is the webview's native zoom (everything scales, coordinates stay
// consistent); in a plain browser (development) CSS zoom stands in.
import { isTauri } from "./files";

const KEY = "maddox.zoom";
const STEPS = [0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2];

let level = read();

function read(): number {
  try {
    const saved = Number(localStorage.getItem(KEY));
    if (STEPS.includes(saved)) return saved;
  } catch {
    // fall through
  }
  return 1;
}

export async function applyZoom() {
  if (isTauri) {
    const { getCurrentWebview } = await import("@tauri-apps/api/webview");
    await getCurrentWebview().setZoom(level);
  } else {
    document.documentElement.style.zoom = level === 1 ? "" : String(level);
  }
}

/** Steps the zoom in (1), out (-1) or back to 100% (0); returns the new level. */
export async function zoom(step: 1 | -1 | 0): Promise<number> {
  const i = STEPS.indexOf(level);
  level = step === 0 ? 1 : STEPS[Math.min(STEPS.length - 1, Math.max(0, i + step))];
  try {
    localStorage.setItem(KEY, String(level));
  } catch {
    // Only a convenience.
  }
  await applyZoom();
  return level;
}
