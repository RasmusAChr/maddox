// Which names a line of Giac input defines and uses, so that changing
// r := 3 to 4 can recalculate the cells below that use r (decision 0007).
// Over-counting is harmless (a cell re-runs for nothing); missing a name is
// not, so anything unclear counts as a use.

import { CALL_OR_PRODUCT } from "./latex-to-giac";

export interface LineNames {
  /** r in r := 4, f in f(x) := x². */
  assigns: string[];
  /** Every other name in the line, ans (maddox_ans) included. */
  reads: string[];
  /** restart, purge, assume: changes the engine beyond its own names. */
  stateful: boolean;
}

const ASSIGNMENT = new RegExp(`^\\s*([A-Za-z][A-Za-z0-9_]*)\\s*(?:${CALL_OR_PRODUCT}?\\([^()]*\\))?\\s*:=`);
const STATEFUL = /\b(restart|purge|assume|additionally|supposons)\b/;

export function lineNames(giac: string): LineNames {
  const assignment = ASSIGNMENT.exec(giac);
  const body = assignment ? giac.slice(assignment[0].length) : giac;
  // Units (_m) and strings ("C") are not names.
  const text = body.replace(/"[^"]*"/g, "").replace(/(?<![A-Za-z0-9_])_[A-Za-z]+/g, "");
  const reads = new Set(text.match(/[A-Za-z][A-Za-z0-9_]*/g) ?? []);
  // The x of f(x) := x² is the function's own parameter, not a use of x.
  if (assignment) {
    const params = /\(([^()]*)\)\s*:=$/.exec(assignment[0])?.[1].split(",").map((p) => p.trim()) ?? [];
    for (const p of params) reads.delete(p);
  }
  return { assigns: assignment ? [assignment[1]] : [], reads: [...reads], stateful: STATEFUL.test(giac) };
}
