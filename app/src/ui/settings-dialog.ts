// The settings dialog (Ctrl+,). Built from a list of settings, so adding one
// means adding an entry in main.ts. Keyboard: ↑/↓ move between settings,
// ←/→ change the value, Enter or Space runs a button, Esc closes. Changes
// apply at once; there is no Save.
import { openDialog } from "./dialogs";

type Base = { id: string; section: string; label: string; hint?: string };

export type Setting =
  | (Base & { kind: "choice"; options: { value: string; label: string }[]; get: () => string; set: (value: string) => void })
  | (Base & { kind: "stepper"; display: () => string; step: (dir: 1 | -1) => void | Promise<void> })
  | (Base & { kind: "action"; button: () => string; enabled: () => boolean; run: () => void });

export function openSettings(dialog: HTMLDialogElement, settings: Setting[], onClose: () => void) {
  const list = dialog.querySelector<HTMLElement>(".settings-list")!;
  list.replaceChildren();
  let section = "";
  for (const setting of settings) {
    if (setting.section !== section) {
      section = setting.section;
      const h = document.createElement("h3");
      h.className = "settings-section";
      h.textContent = section;
      list.append(h);
    }
    list.append(row(setting));
  }

  const rows = () => [...list.querySelectorAll<HTMLElement>(".setting")];
  dialog.onkeydown = (e) => {
    const current = (document.activeElement as HTMLElement | null)?.closest<HTMLElement>(".setting");
    const all = rows();
    const i = current ? all.indexOf(current) : -1;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const next = all[Math.min(all.length - 1, Math.max(0, i + (e.key === "ArrowDown" ? 1 : -1)))];
      next?.focus();
    } else if ((e.key === "ArrowLeft" || e.key === "ArrowRight") && current) {
      e.preventDefault();
      change(current, e.key === "ArrowRight" ? 1 : -1);
    } else if ((e.key === "Enter" || e.key === " ") && current?.dataset.kind === "action") {
      e.preventDefault();
      current.querySelector<HTMLButtonElement>("button")?.click();
    }
  };

  function change(rowEl: HTMLElement, dir: 1 | -1) {
    const setting = settings.find((s) => s.id === rowEl.dataset.id)!;
    if (setting.kind === "choice") {
      const values = setting.options.map((o) => o.value);
      const next = values[Math.min(values.length - 1, Math.max(0, values.indexOf(setting.get()) + dir))];
      if (next !== setting.get()) {
        setting.set(next);
        refresh(rowEl, setting);
      }
    } else if (setting.kind === "stepper") {
      void Promise.resolve(setting.step(dir)).then(() => refresh(rowEl, setting));
    }
  }

  function row(setting: Setting): HTMLElement {
    const el = document.createElement("div");
    el.className = "setting";
    el.tabIndex = 0;
    el.dataset.id = setting.id;
    el.dataset.kind = setting.kind;
    el.innerHTML = `<div class="setting-text"><span class="setting-label"></span><span class="setting-hint"></span></div><div class="setting-control"></div>`;
    el.querySelector(".setting-label")!.textContent = setting.label;
    el.querySelector(".setting-hint")!.textContent = setting.hint ?? "";
    refresh(el, setting);
    return el;
  }

  function refresh(el: HTMLElement, setting: Setting) {
    const control = el.querySelector<HTMLElement>(".setting-control")!;
    control.replaceChildren();
    const button = (label: string, onClick: () => void, extra = "") => {
      const b = document.createElement("button");
      b.type = "button";
      b.tabIndex = -1; // the row takes focus; arrows change it
      b.className = extra;
      b.textContent = label;
      b.addEventListener("mousedown", (e) => e.preventDefault());
      b.addEventListener("click", () => {
        onClick();
        el.focus();
      });
      return b;
    };
    if (setting.kind === "choice") {
      const seg = document.createElement("div");
      seg.className = "seg";
      for (const option of setting.options) {
        const b = button(option.label, () => {
          if (setting.get() !== option.value) {
            setting.set(option.value);
            refresh(el, setting);
          }
        });
        b.setAttribute("aria-pressed", String(setting.get() === option.value));
        seg.append(b);
      }
      control.append(seg);
    } else if (setting.kind === "stepper") {
      const value = document.createElement("span");
      value.className = "stepper-value";
      value.textContent = setting.display();
      const step = (dir: 1 | -1) => () => void Promise.resolve(setting.step(dir)).then(() => refresh(el, setting));
      control.append(button("−", step(-1), "stepper-button"), value, button("+", step(1), "stepper-button"));
    } else {
      const b = button(setting.button(), () => {
        setting.run();
        refresh(el, setting);
      }, "action-button");
      b.disabled = !setting.enabled();
      control.append(b);
    }
  }

  openDialog(dialog, () => {
    dialog.onkeydown = null;
    onClose();
  });
  rows()[0]?.focus();
}
