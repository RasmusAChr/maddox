import type { MathfieldElement } from "mathlive";
import { fillEmptyMatrixCells, parentEnvironment } from "./mathlive-internals";

/** `cases`: a piecewise function's brace, edited like a matrix with two fixed columns. */
export type MatrixInfo = { rows: number; cols: number; cases: boolean };

/** The matrix (or piecewise brace) around the caret, if any. */
export function matrixAtCaret(mf: MathfieldElement): MatrixInfo | null {
  const env = parentEnvironment(mf);
  const name = env?.environmentName ?? "";
  if (!env || !(/matrix$/.test(name) || name === "cases")) return null;
  return { rows: env.rowCount, cols: env.colCount, cases: name === "cases" };
}

export type MatrixAction = "addRowAbove" | "addRowBelow" | "addColumnLeft" | "addColumnRight" | "removeRow" | "removeColumn";

const COMMANDS = {
  addRowAbove: "addRowBefore",
  addRowBelow: "addRowAfter",
  addColumnLeft: "addColumnBefore",
  addColumnRight: "addColumnAfter",
  removeRow: "removeRow",
  removeColumn: "removeColumn",
} as const;

/** Returns false when the caret is not in a matrix (nothing happens then). */
export function editMatrix(mf: MathfieldElement, action: MatrixAction): boolean {
  const info = matrixAtCaret(mf);
  if (!info) return false;
  // A case is always a value and a condition.
  if (info.cases && /Column/.test(action)) return true;
  if (action === "removeRow" && info.rows === 1) return true;
  if (action === "removeColumn" && info.cols === 1) return true;
  mf.executeCommand(COMMANDS[action]);
  fillEmptyMatrixCells(mf);
  return true;
}

export function matrixLatex(rows: number, cols: number): string {
  const row = Array(cols).fill("\\placeholder{}").join("&");
  return `\\begin{pmatrix}${Array(rows).fill(row).join("\\\\")}\\end{pmatrix}`;
}
