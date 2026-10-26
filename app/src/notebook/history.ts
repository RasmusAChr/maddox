/**
 * Undo and redo for the whole notebook: one list of steps in the order they
 * happened, whichever cell they were in (Ctrl+Z, Ctrl+Y / Ctrl+Shift+Z).
 * Steps are opaque here; the notebook knows how to undo and redo each.
 *
 * Typing joins the step before it while it is a run of the same kind in the
 * same cell: letters and digits (a word), or deletions. An operator, a pause,
 * moving the caret or going to another cell starts a new step.
 */

/** What a key does to the text, for joining steps: a word, a deletion, or a step of its own (null). */
export type Typing = "word" | "delete" | null;

/** A typing pause longer than this starts a new step. */
export const PAUSE_MS = 1000;
/** Steps kept; the oldest go first. */
export const LIMIT = 500;

export function typingOf(e: { key: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean }): Typing {
  if (e.ctrlKey || e.metaKey || e.altKey) return null;
  if (e.key === "Backspace" || e.key === "Delete") return "delete";
  if (/^[\p{L}\p{N}.]$/u.test(e.key)) return "word";
  return null;
}

/** Steps that can join the one before them carry `join`: the cell, the kind of typing, and when. */
type Joinable = { join?: { owner: unknown; typing: Typing; at: number } };

export class History<S extends object> {
  private done: S[] = [];
  private undone: S[] = [];
  /** Set by seal(): the next step never joins the last one. */
  private sealed = false;

  /**
   * Adds a step, or joins it to the last one when both are the same kind of
   * typing in the same cell, within PAUSE_MS. Returns the step now on top,
   * so the caller can update a joined step's end state.
   */
  push(step: S, merge: (into: S, step: S) => void): S {
    this.undone = [];
    const last = this.done[this.done.length - 1];
    const a = (last as Joinable | undefined)?.join;
    const b = (step as Joinable).join;
    if (!this.sealed && a && b && a.owner === b.owner && a.typing && a.typing === b.typing && b.at - a.at <= PAUSE_MS) {
      merge(last, step);
      a.at = b.at;
      return last;
    }
    this.sealed = false;
    this.done.push(step);
    if (this.done.length > LIMIT) this.done.shift();
    return step;
  }

  /** The step on top, if it may still be changed (nothing undone since). */
  get last(): S | undefined {
    return this.undone.length ? undefined : this.done[this.done.length - 1];
  }

  /** The next step starts fresh (the caret moved, or another cell). */
  seal() {
    this.sealed = true;
  }

  /** The step to undo, moved to the redo list. */
  undo(): S | undefined {
    const step = this.done.pop();
    if (step) this.undone.push(step);
    this.sealed = true;
    return step;
  }

  /** The step to redo, moved back to the undo list. */
  redo(): S | undefined {
    const step = this.undone.pop();
    if (step) this.done.push(step);
    this.sealed = true;
    return step;
  }

  clear() {
    this.done = [];
    this.undone = [];
    this.sealed = false;
  }
}
