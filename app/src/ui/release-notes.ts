/**
 * Release notes (CHANGELOG.md's markdown) for the update dialog. Only what
 * the changelog uses: "### Heading", "- " bullets whose text may wrap onto
 * indented lines, plain paragraphs, and `code`.
 */
export type NotesBlock =
  | { kind: "heading"; text: string }
  | { kind: "list"; items: string[] }
  | { kind: "text"; text: string };

export function parseNotes(markdown: string): NotesBlock[] {
  const blocks: NotesBlock[] = [];
  let last: NotesBlock | null = null; // the block a wrapped line continues
  for (const raw of markdown.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) {
      last = null;
      continue;
    }
    const heading = /^#+\s+(.*)$/.exec(line);
    const bullet = /^[-*]\s+(.*)$/.exec(line);
    if (heading) {
      blocks.push({ kind: "heading", text: heading[1] });
      last = null;
    } else if (bullet) {
      if (last?.kind === "list") last.items.push(bullet[1]);
      else blocks.push((last = { kind: "list", items: [bullet[1]] }));
    } else if (last?.kind === "list") {
      last.items[last.items.length - 1] += " " + line;
    } else if (last?.kind === "text") {
      last.text += " " + line;
    } else {
      blocks.push((last = { kind: "text", text: line }));
    }
  }
  return blocks;
}

/** "a `b` c" → ["a ", "b", " c"]: odd pieces are code. */
export function inlineCode(text: string): string[] {
  return text.split(/`([^`]*)`/);
}
