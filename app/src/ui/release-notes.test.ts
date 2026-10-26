import { describe, expect, it } from "vitest";
import { inlineCode, parseNotes } from "./release-notes";

describe("parseNotes", () => {
  it("reads headings and bullets, joining wrapped lines", () => {
    const notes = "### New\n\n- Print with Ctrl+Shift+P.\n- Suggestions as you type: after two\n  letters.\n\n### Fixed\n\n- Esc closes Settings.";
    expect(parseNotes(notes)).toEqual([
      { kind: "heading", text: "New" },
      { kind: "list", items: ["Print with Ctrl+Shift+P.", "Suggestions as you type: after two letters."] },
      { kind: "heading", text: "Fixed" },
      { kind: "list", items: ["Esc closes Settings."] },
    ]);
  });

  it("keeps a paragraph as text", () => {
    expect(parseNotes("The first release\nof Maddox.")).toEqual([{ kind: "text", text: "The first release of Maddox." }]);
  });

  it("is empty for no notes", () => {
    expect(parseNotes("  \n")).toEqual([]);
  });
});

describe("inlineCode", () => {
  it("splits out `code`", () => {
    expect(inlineCode("names like `determinant` stay")).toEqual(["names like ", "determinant", " stay"]);
    expect(inlineCode("no code")).toEqual(["no code"]);
  });
});
