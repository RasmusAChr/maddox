import type { MathfieldElement } from "mathlive";
import { fillEmptyMatrixCells, parentEnvironment } from "./mathlive-internals";

export type MatrixInfo = { rows: number; cols: number };

/** The matrix around the caret, if any. */
export function matrixAtCaret(mf: MathfieldElement): MatrixInfo | null {
  const env = parentEnvironment(mf);
  if (!env || !/matrix$/.test(env.environmentName ?? "")) return null;
  return { rows: env.rowCount, cols: env.colCount };
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
