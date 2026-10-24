// Everything that reaches into MathLive's private state lives here, because
// the public API has no way to do it. mathlive is pinned to an exact version
// in package.json; re-check these after upgrading it (e2e/smoke.mjs covers
// all of them).
import { MathfieldElement } from "mathlive";

type ArrayAtom = { environmentName?: string; rowCount: number; colCount: number };

function internal(mf: MathfieldElement): any {
  return (mf as any)._mathfield;
}

// MathLive does not export its placeholder atom class; take it from a
// throwaway field that contains one.
let placeholderClass: (new () => any) | null | undefined;
function getPlaceholderClass(): (new () => any) | null {
  if (placeholderClass !== undefined) return placeholderClass;
  const probe = new MathfieldElement();
  probe.style.display = "none";
  document.body.append(probe);
  probe.value = "\\placeholder{}";
  const atom = internal(probe)?.model?.root?.children?.find((a: any) => a.type === "placeholder");
  placeholderClass = atom?.constructor ?? null;
  probe.remove();
  return placeholderClass ?? null;
}

/**
 * Puts a placeholder box into every empty matrix (or piecewise) cell, so each cell always
 * shows where to type. MathLive leaves cells empty after adding a column, or
 * once their content (or the box itself) is deleted. Returns true if it
 * changed anything.
 */
export function fillEmptyMatrixCells(mf: MathfieldElement): boolean {
  try {
    const Placeholder = getPlaceholderClass();
    const model = internal(mf)?.model;
    if (!Placeholder || !model) return false;
    const matrices = [model.root, ...model.root.children].filter(
      (a: any) => a.type === "array" && /matrix$|^cases$/.test(a.environmentName ?? ""),
    );
    const caret = model.at(model.position);
    let caretTarget: any = null;
    let changed = false;
    for (const matrix of matrices) {
      for (let r = 0; r < matrix.rowCount; r++) {
        for (let c = 0; c < matrix.colCount; c++) {
          const cell = matrix.getCell(r, c);
          if (!cell || !cell.every((a: any) => a.type === "first")) continue;
          const box = new Placeholder();
          matrix.setCell(r, c, [box]);
          changed = true;
          if (cell.includes(caret)) caretTarget = box;
        }
      }
    }
    if (!changed) return false;
    // A caret that sat in a filled cell now sits on its box, as MathLive does
    // when you move into a fresh cell.
    model.position = model.offsetOf(caretTarget ?? caret);
    // Re-assigning an option is the public way to request a re-render.
    mf.placeholderSymbol = mf.placeholderSymbol;
    return true;
  } catch {
    return false;
  }
}

/** The array/matrix environment around the caret, if any. */
export function parentEnvironment(mf: MathfieldElement): ArrayAtom | null {
  try {
    return internal(mf)?.model?.parentEnvironment ?? null;
  } catch {
    return null;
  }
}

/** The top-level atom (a direct child of the root) containing the caret. */
function topLevelAtCaret(model: any): any {
  let atom = model.at(model.position);
  while (atom?.parent && atom.parent !== model.root) atom = atom.parent;
  return atom;
}

/** True when the caret is at the very start of a line of the cell. */
export function atLineStart(mf: MathfieldElement): boolean {
  try {
    const model = internal(mf).model;
    const atom = model.at(model.position);
    return atom?.type === "first" && atom.parent === model.root;
  } catch {
    return false;
  }
}

/**
 * Starts a new line in the cell. At the top level this splits the line at
 * the caret. Inside a matrix, fraction, etc. it ends the current line first,
 * because MathLive's add-row there would grow the matrix instead.
 */
export function breakLine(mf: MathfieldElement) {
  try {
    const model = internal(mf).model;
    const top = topLevelAtCaret(model);
    if (top && top !== model.at(model.position)) model.position = model.offsetOf(top.lastSibling);
  } catch {
    // fall through: add the row wherever the caret is
  }
  mf.executeCommand("addRowAfter");
}

/**
 * Deletion at the edge of brackets, where MathLive would remove a single
 * bracket and leave half a fence (e.g. "solve, x)"). A "call" is the
 * brackets plus the function name in front of them, if any.
 *
 * With the caret just inside the brackets:
 * - empty brackets (or only boxes): any delete key removes the whole call
 * - Backspace at the start / Delete at the end: select the whole call, so a
 *   second press deletes it
 * - Ctrl+Backspace at the start / Ctrl+Delete at the end: delete it at once
 *
 * Returns true when it handled the key.
 */
export function deleteAtBrackets(mf: MathfieldElement, key: "Backspace" | "Delete", ctrl: boolean): boolean {
  try {
    const model = internal(mf).model;
    if (model.selectionIsCollapsed === false) return false;
    const atom = model.at(model.position);
    const fence = atom?.parent;
    if (fence?.type !== "leftright") return false;
    const atStart = atom.type === "first";
    const atEnd = atom.isLastSibling;
    const empty = (fence.body ?? []).every((a: any) => a.type === "first" || a.type === "placeholder");

    const before = fence.leftSibling;
    const start = before?.isFunction ? before : fence;
    const range: [number, number] = [model.offsetOf(start.leftSibling), model.offsetOf(fence)];
    const remove = () => {
      mf.selection = { ranges: [range], direction: "forward" };
      mf.executeCommand("deleteBackward");
    };

    if (empty && (atStart || atEnd)) return remove(), true;
    const towardEdge = (key === "Backspace" && atStart) || (key === "Delete" && atEnd);
    if (!towardEdge) return false;
    if (ctrl) return remove(), true;
    mf.selection = { ranges: [range], direction: key === "Backspace" ? "backward" : "forward" };
    return true;
  } catch {
    return false;
  }
}

/** A letter or digit; runs of these form one "word" for Ctrl+arrows. */
function isWordAtom(atom: any): boolean {
  return atom?.type === "mord" && typeof atom.value === "string" && /^[\p{L}\p{N}.]$/u.test(atom.value);
}

/**
 * Ctrl+←/→: move like Ctrl+arrows in a text editor. MathLive's own binding
 * jumps to the start/end of the current group and so gets stuck at a group
 * edge, e.g. right before the "(" of transpose(A).
 *
 * One jump crosses a run of letters/digits, or one whole atom (an operator,
 * a function name, brackets with their content, a fraction, a matrix). At the
 * edge of a group (inside brackets, a numerator, a matrix cell) the jump
 * leaves the group. With `extend`, the selection grows instead (Shift).
 */
export function moveByWord(mf: MathfieldElement, direction: "left" | "right", extend: boolean) {
  try {
    const model = internal(mf).model;
    const root = model.root;
    const here = model.at(model.position);
    let target: number | null = null;

    if (direction === "left") {
      if (here.type === "first") {
        // At the start of a group: step out to just before it.
        const parent = here.parent;
        if (parent && parent !== root) target = model.offsetOf(parent.leftSibling ?? parent);
      } else {
        let atom = here;
        if (isWordAtom(atom)) while (isWordAtom(atom.leftSibling)) atom = atom.leftSibling;
        target = model.offsetOf(atom.leftSibling);
      }
    } else {
      const next = here.rightSibling;
      if (!next) {
        // At the end of a group: step out to just after it.
        const parent = here.parent;
        if (parent && parent !== root) target = model.offsetOf(parent);
      } else {
        let atom = next;
        if (isWordAtom(atom)) while (isWordAtom(atom.rightSibling)) atom = atom.rightSibling;
        target = model.offsetOf(atom);
      }
    }
    if (target === null || target < 0) return;
    if (extend) {
      mf.selection = { ranges: [[model.anchor, target]], direction: direction === "left" ? "backward" : "forward" };
    } else {
      mf.position = target;
    }
  } catch {
    // leave the caret where it is
  }
}

/** The index of the cell line the caret is on (0 for a one-line cell). */
export function caretLine(mf: MathfieldElement): number {
  try {
    const model = internal(mf).model;
    const root = model.root;
    if (root.type !== "array") return 0;
    let atom = model.at(model.position);
    while (atom?.parent && atom.parent !== root) atom = atom.parent;
    return Array.isArray(atom?.parentBranch) ? atom.parentBranch[0] : 0;
  } catch {
    return 0;
  }
}

export type LineBox = { top: number; bottom: number; left: number; right: number };

/** The on-screen extent of each line of the cell, in document order. */
export function lineBoxes(mf: MathfieldElement): LineBox[] {
  try {
    const model = internal(mf).model;
    const root = model.root;
    const rows = root.type === "array" ? root.rowCount : 1;
    const boxes: (LineBox | null)[] = Array(rows).fill(null);
    for (let offset = 0; offset <= mf.lastOffset; offset++) {
      let atom = model.at(offset);
      while (atom?.parent && atom.parent !== root) atom = atom.parent;
      const row = root.type === "array" && Array.isArray(atom?.parentBranch) ? atom.parentBranch[0] : 0;
      const bounds = mf.getElementInfo(offset)?.bounds;
      if (!bounds || bounds.height === 0) continue;
      const box = boxes[row];
      boxes[row] = box
        ? {
            top: Math.min(box.top, bounds.top),
            bottom: Math.max(box.bottom, bounds.bottom),
            left: Math.min(box.left, bounds.left),
            right: Math.max(box.right, bounds.right),
          }
        : { top: bounds.top, bottom: bounds.bottom, left: bounds.left, right: bounds.right };
    }
    return boxes.map((b) => b ?? { top: 0, bottom: 0, left: 0, right: 0 });
  } catch {
    return [];
  }
}

/**
 * Focuses `mf` and moves keyboard input to it at once. MathLive's focus()
 * hands the keyboard over only after a 60 ms timer, and keys typed in the
 * meantime land in the previously focused field.
 */
export function focusImmediately(mf: MathfieldElement) {
  // MathLive's delayed focus takes the keyboard only if focus is still where
  // it was when focus() was called. If that was e.g. the template search
  // field, and the user goes back there within 60 ms, MathLive would steal
  // the keyboard from it. Blurring first makes "where it was" <body>.
  const previous = document.activeElement;
  if (previous instanceof HTMLElement && previous !== mf) previous.blur();
  mf.focus();
  try {
    internal(mf)?.keyboardDelegate?.focus();
  } catch {
    // MathLive's own delayed focus still applies.
  }
}
