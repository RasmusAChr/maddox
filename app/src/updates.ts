// Updates. The desktop app asks for latest.json on the newest GitHub Release
// (the Tauri updater; tauri.conf.json names the address and the key that
// signs updates). main.ts checks at startup and once a day while open,
// unless Settings turns that off; nothing installs until the user says so.
import { isTauri } from "./files";
import { version } from "../package.json";

/** This build's version: package.json is the only place it is written. */
export const appVersion = version;

export type Update = {
  version: string;
  /** The release notes (CHANGELOG.md's section for that version). */
  notes: string;
  /** Downloads, installs and restarts. progress gets 0…1, or null when the size is unknown. */
  install: (progress: (fraction: number | null) => void) => Promise<void>;
};

// In `npm run dev` (a browser, no updater) the e2e test announces a pretend
// update through this key; installing it only records that it happened.
const FAKE_KEY = "maddox.fake-update";

function fakeUpdate(): Update | null {
  try {
    const fake = JSON.parse(localStorage.getItem(FAKE_KEY) ?? "null");
    if (!fake?.version) return null;
    return {
      version: fake.version,
      notes: fake.notes ?? "",
      install: async (progress) => {
        progress(0.5);
        progress(1);
        localStorage.setItem(FAKE_KEY, JSON.stringify({ ...fake, installed: true }));
      },
    };
  } catch {
    return null;
  }
}

/** Whether this build can update itself (the desktop app). */
export const canUpdate = isTauri || import.meta.env.DEV;

/** A newer version, or null. Throws when the check fails (offline, no release yet). */
export async function checkForUpdate(): Promise<Update | null> {
  if (!isTauri) return import.meta.env.DEV ? fakeUpdate() : null;
  const { check } = await import("@tauri-apps/plugin-updater");
  const update = await check();
  if (!update) return null;
  return {
    version: update.version,
    notes: update.body ?? "",
    install: async (progress) => {
      let total = 0;
      let received = 0;
      // On Windows the installer closes Maddox and starts the new version
      // itself; elsewhere the restart below does it.
      await update.downloadAndInstall((event) => {
        if (event.event === "Started") total = event.data.contentLength ?? 0;
        else if (event.event === "Progress") {
          received += event.data.chunkLength;
          progress(total ? received / total : null);
        }
      });
      const { relaunch } = await import("@tauri-apps/plugin-process");
      await relaunch();
    },
  };
}
