import { describe, expect, it } from "vitest";
import { History, LIMIT, PAUSE_MS, typingOf, type Typing } from "./history";

type Step = { text: string; join?: { owner: unknown; typing: Typing; at: number } };
const merge = (into: Step, step: Step) => {
  into.text += step.text;
};
const key = (k: string, mods: Partial<{ ctrlKey: boolean; altKey: boolean }> = {}) =>
  typingOf({ key: k, ctrlKey: false, metaKey: false, altKey: false, ...mods });

describe("typingOf", () => {
  it("letters, digits and the decimal point are a word", () => {
    expect(["a", "Z", "7", ".", "ø", "θ"].map((k) => key(k))).toEqual(Array(6).fill("word"));
  });
  it("Backspace and Delete are deletions", () => {
    expect([key("Backspace"), key("Delete")]).toEqual(["delete", "delete"]);
  });
  it("operators, Enter and shortcuts are steps of their own", () => {
    expect([key("+"), key("-"), key("^"), key(" "), key("Enter"), key("a", { ctrlKey: true }), key("Backspace", { altKey: true })]).toEqual(Array(7).fill(null));
  });
});

describe("History", () => {
  const cell = {};
  const typed = (text: string, typing: Typing, at: number, owner: unknown = cell): Step => ({ text, join: { owner, typing, at } });

  it("joins a run of typing in one cell", () => {
    const h = new History<Step>();
    h.push(typed("3", "word", 0), merge);
    h.push(typed("x", "word", 100), merge);
    expect(h.undo()?.text).toBe("3x");
    expect(h.undo()).toBeUndefined();
  });

  it("an operator, a pause, a deletion or another cell starts a new step", () => {
    const h = new History<Step>();
    h.push(typed("3", "word", 0), merge);
    h.push(typed("+", null, 50), merge);
    h.push(typed("4", "word", 100), merge);
    h.push(typed("5", "word", 100 + PAUSE_MS + 1), merge);
    h.push(typed("⌫", "delete", PAUSE_MS + 200), merge);
    h.push(typed("6", "word", PAUSE_MS + 300, {}), merge);
    expect([h.undo(), h.undo(), h.undo(), h.undo(), h.undo(), h.undo()].map((s) => s?.text)).toEqual(["6", "⌫", "5", "4", "+", "3"]);
  });

  it("seal() and undo() stop the next step from joining", () => {
    const h = new History<Step>();
    h.push(typed("a", "word", 0), merge);
    h.seal();
    h.push(typed("b", "word", 10), merge);
    h.undo();
    h.push(typed("c", "word", 20), merge);
    expect([h.undo()?.text, h.undo()?.text]).toEqual(["c", "a"]);
  });

  it("redo puts back what undo took, until something new happens", () => {
    const h = new History<Step>();
    h.push({ text: "word" }, merge);
    h.push({ text: "delete cell" }, merge);
    expect(h.undo()?.text).toBe("delete cell");
    expect(h.undo()?.text).toBe("word");
    expect(h.redo()?.text).toBe("word");
    expect(h.last).toBeUndefined(); // "delete cell" can still be redone
    h.push({ text: "new" }, merge);
    expect(h.redo()).toBeUndefined();
    expect(h.last?.text).toBe("new");
  });

  it("keeps the newest LIMIT steps", () => {
    const h = new History<Step>();
    for (let i = 0; i < LIMIT + 5; i++) h.push({ text: String(i) }, merge);
    let n = 0;
    while (h.undo()) n++;
    expect(n).toBe(LIMIT);
  });
});
