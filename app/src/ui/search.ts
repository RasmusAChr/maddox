// Matching shared by the Ctrl+P search and the sidebar's search field.

export type Searchable = {
  label: string;
  hint?: string;
  description: string;
  keywords?: string;
  group: string;
};

const WORD = /[^\p{L}\p{N}]+/u;

export function queryWords(query: string): string[] {
  return query.trim().toLowerCase().split(/\s+/).filter(Boolean);
}

/** Scores one query word against an item; 0 means no match. */
function scoreWord(item: Searchable, word: string): number {
  const label = item.label.toLowerCase();
  if (label === word) return 100;
  if (label.startsWith(word)) return 60;
  if (label.split(WORD).some((w) => w.startsWith(word))) return 40;
  if (label.includes(word)) return 25;
  if (item.hint?.toLowerCase().includes(word)) return 20;
  const words = `${item.keywords ?? ""} ${item.description} ${item.group}`.toLowerCase();
  if (words.split(WORD).some((w) => w.startsWith(word))) return 15;
  return words.includes(word) ? 5 : 0;
}

/** Every word must match somewhere ("def int" finds Definite integral); 0 means no match. */
export function score(item: Searchable, words: string[]): number {
  let total = 0;
  for (const word of words) {
    const s = scoreWord(item, word);
    if (!s) return 0;
    total += s;
  }
  return total;
}
