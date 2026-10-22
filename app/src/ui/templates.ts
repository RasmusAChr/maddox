import { CATALOG, CATEGORIES, type CatalogItem, type Category } from "./commands";
import { queryWords, score } from "./search";

// The template sidebar. Collapsed it is a thin strip with one expand button;
// open it lists each category's everyday templates, with the rest behind
// "More", and a search field that filters them (the same matching as Ctrl+P).
// It works without the mouse: opening it focuses the search field, ↑/↓ move a
// highlighted selection, Enter inserts it, Esc goes back to the notebook.

const STATE_KEY = "maddox.templates";

type State = {
  collapsed: boolean;
  /** Categories the user closed. */
  closed: string[];
  /** Categories showing their advanced templates. */
  more: string[];
};

function loadState(): State {
  try {
    const saved = JSON.parse(localStorage.getItem(STATE_KEY) ?? "null");
    if (saved && typeof saved.collapsed === "boolean") {
      return { collapsed: saved.collapsed, closed: saved.closed ?? [], more: saved.more ?? [] };
    }
  } catch {
    // fall through to the default
  }
  // Start out of the way; the strip shows it is there.
  return { collapsed: true, closed: [], more: [] };
}

let state: State = loadState();
let panel: HTMLElement;
let filterInput: HTMLInputElement;
let pick: (item: CatalogItem) => void;
let onLeave: () => void;
/** The highlighted template or "More" button, moved with ↑/↓. */
let selected: HTMLElement | null = null;

function save() {
  try {
    localStorage.setItem(STATE_KEY, JSON.stringify(state));
  } catch {
    // Only a convenience.
  }
}

function toggleIn(list: string[], id: string, on: boolean): string[] {
  return on ? [...new Set([...list, id])] : list.filter((x) => x !== id);
}

/** `leave` returns focus to the notebook (after Esc in the search field). */
export function renderTemplates(el: HTMLElement, onPick: (item: CatalogItem) => void, leave: () => void) {
  panel = el;
  pick = onPick;
  onLeave = leave;
  panel.replaceChildren(rail(), header(), searchRow(), list());
  apply();
}

/** Ctrl+B and the toolbar button: opening focuses the search field, closing returns to the notebook. */
export function toggleTemplates() {
  state.collapsed = !state.collapsed;
  save();
  apply();
  if (!state.collapsed) {
    filterInput.focus();
    filterInput.select();
  } else if (panel.contains(document.activeElement)) {
    clearFilter();
    onLeave();
  }
}

function apply() {
  panel.classList.toggle("collapsed", state.collapsed);
  document.querySelector('[data-action="templates"]')?.setAttribute("aria-pressed", String(!state.collapsed));
  const filtering = queryWords(filterInput.value).length > 0;
  panel.classList.toggle("filtering", filtering);
  for (const section of panel.querySelectorAll<HTMLElement>(".tcat")) {
    const id = section.dataset.id!;
    const closed = !filtering && state.closed.includes(id);
    section.classList.toggle("closed", closed);
    section.classList.toggle("show-more", state.more.includes(id));
    section.querySelector(".tcat-head")!.setAttribute("aria-expanded", String(!closed));
  }
}

function button(className: string, label: string, title: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement("button");
  b.className = className;
  b.textContent = label;
  b.title = title;
  // Keep focus (and the caret) in the entry being edited.
  b.addEventListener("mousedown", (e) => e.preventDefault());
  b.addEventListener("click", onClick);
  return b;
}

/** Shown when collapsed: just the expand button. */
function rail(): HTMLElement {
  const nav = document.createElement("div");
  nav.className = "templates-rail";
  nav.append(button("rail-expand", "»", "Show templates (Ctrl+B)", toggleTemplates));
  return nav;
}

function header(): HTMLElement {
  const head = document.createElement("div");
  head.className = "templates-head";
  const title = document.createElement("span");
  title.className = "templates-title";
  title.textContent = "Templates";
  head.append(title, button("templates-collapse", "«", "Hide templates (Ctrl+B)", toggleTemplates));
  return head;
}

function searchRow(): HTMLElement {
  const row = document.createElement("div");
  row.className = "templates-search";
  filterInput = document.createElement("input");
  filterInput.type = "search";
  filterInput.placeholder = "Search templates";
  filterInput.spellcheck = false;
  filterInput.setAttribute("aria-label", "Search templates");
  filterInput.addEventListener("input", filter);
  // The highlight belongs to the keyboard; hide it once focus leaves.
  filterInput.addEventListener("blur", () => select(null));
  filterInput.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      moveSelection(e.key === "ArrowDown" ? 1 : -1);
    } else if (e.key === "Enter" && selected) {
      e.preventDefault();
      activate(selected);
    } else if (e.key === "Escape") {
      e.preventDefault();
      clearFilter();
      onLeave();
    }
  });
  const hint = document.createElement("kbd");
  hint.textContent = "Ctrl P";
  hint.title = "Ctrl+P searches everything from anywhere";
  row.append(filterInput, hint);
  return row;
}

function clearFilter() {
  filterInput.value = "";
  filter();
}

/** Templates and "More" buttons currently on screen, top to bottom. */
function navigable(): HTMLElement[] {
  return [...panel.querySelectorAll<HTMLElement>(".template, .tcat-more")].filter((el) => el.offsetParent !== null);
}

function select(el: HTMLElement | null) {
  selected?.classList.remove("selected");
  selected = el;
  selected?.classList.add("selected");
  selected?.scrollIntoView({ block: "nearest" });
}

function moveSelection(step: 1 | -1) {
  const items = navigable();
  if (!items.length) return;
  const i = selected ? items.indexOf(selected) : -1;
  // From nothing, ↓ starts at the top and ↑ at the bottom.
  const next = i < 0 ? (step === 1 ? 0 : items.length - 1) : (i + step + items.length) % items.length;
  select(items[next]);
}

/** Enter on the selection: insert a template, or expand/collapse "More". */
function activate(el: HTMLElement) {
  if (el.classList.contains("tcat-more")) {
    el.click();
    // The button stays put; keep it selected so Enter toggles back.
    select(el);
    return;
  }
  const item = CATALOG[Number(el.dataset.index)];
  clearFilter();
  pick(item);
}

/** Shows only matching templates (advanced ones included), best match first in each category. */
function filter() {
  const words = queryWords(filterInput.value);
  const groupName = new Map(CATEGORIES.map((c) => [c.id, c.name]));
  let top = 0;
  let best: HTMLElement | null = null;
  for (const b of panel.querySelectorAll<HTMLElement>(".template")) {
    const item = CATALOG[Number(b.dataset.index)];
    const s = words.length
      ? score({ label: item.label, hint: item.syntax, description: item.description, keywords: item.keywords, group: groupName.get(item.category) ?? "" }, words)
      : 0;
    b.classList.toggle("match", s > 0);
    if (s > top) {
      top = s;
      best = b;
    }
  }
  for (const section of panel.querySelectorAll<HTMLElement>(".tcat")) {
    section.classList.toggle("no-match", words.length > 0 && !section.querySelector(".template.match"));
  }
  panel.querySelector(".templates-empty")!.toggleAttribute("hidden", !words.length || best !== null);
  apply();
  // Typing selects the best match, so Enter inserts it straight away.
  select(best);
}

function list(): HTMLElement {
  const container = document.createElement("div");
  container.className = "templates-list";
  for (const category of CATEGORIES) container.append(section(category));
  const empty = document.createElement("div");
  empty.className = "templates-empty";
  empty.textContent = "No template matches";
  empty.hidden = true;
  container.append(empty);
  return container;
}

function section(category: Category): HTMLElement {
  const el = document.createElement("section");
  el.className = "tcat";
  el.dataset.id = category.id;
  const items = CATALOG.filter((i) => i.category === category.id);
  const advanced = items.filter((i) => i.advanced).length;

  const head = button("tcat-head", "", category.name, () => {
    state.closed = toggleIn(state.closed, category.id, !state.closed.includes(category.id));
    save();
    apply();
  });
  head.innerHTML = `<span class="tcat-icon"></span><span class="tcat-name"></span><span class="tcat-chevron" aria-hidden="true">▾</span>`;
  head.querySelector(".tcat-icon")!.textContent = category.icon;
  head.querySelector(".tcat-name")!.textContent = category.name;
  el.append(head);

  const body = document.createElement("div");
  body.className = "tcat-body";
  for (const item of items) {
    const b = button(item.advanced ? "template advanced" : "template", "", item.description, () => {
      clearFilter();
      pick(item);
    });
    b.dataset.index = String(CATALOG.indexOf(item));
    b.innerHTML = `<span class="template-name"></span><code class="template-syntax"></code>`;
    b.querySelector(".template-name")!.textContent = item.label;
    b.querySelector(".template-syntax")!.textContent = item.syntax && item.syntax !== item.label ? item.syntax : "";
    body.append(b);
  }
  if (advanced) {
    const more = button("tcat-more", "", "", () => {
      state.more = toggleIn(state.more, category.id, !state.more.includes(category.id));
      save();
      apply();
    });
    more.innerHTML = `<span class="more-show">More (${advanced})</span><span class="more-hide">Fewer</span>`;
    body.append(more);
  }
  el.append(body);
  return el;
}
