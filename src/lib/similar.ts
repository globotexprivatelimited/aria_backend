/**
 * Are two requests about the same thing? Judged on content words only: "2 towels for room 104" and
 * "2 pillows for room 104" share nothing that matters, while "AC not cooling" and "the AC is not cooling
 * properly" are one complaint. Used by the executor's duplicate check and by the agent's memory.
 */

/** Words that appear in almost every request and say nothing about what it is for - room numbers included. */
const FILLER = new Set(["room", "guest", "guests", "needs", "need", "wants", "want", "would", "like", "requested", "request", "requests", "please", "pls", "for", "the", "and", "with", "from", "to", "in", "at", "of", "is", "are", "an", "extra", "more", "some", "send", "sent", "asked", "asks", "says", "said", "housekeeping", "maintenance", "service", "front", "desk", "concierge", "order", "total", "just", "now", "today", "tonight", "tomorrow", "asap", "urgent", "urgently", "immediately", "soon", "kindly"]);
const plain = (s: string): string => s.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();
/** cleaned, cleaning and clean are one word here; so are towel and towels. */
const stem = (w: string): string => (w.length > 4 ? w.replace(/(ing|ies|ed|es|s)$/, "") : w);

export const contentWords = (s: string): Set<string> => new Set(plain(s).split(" ").filter((w) => w.length >= 2 && !FILLER.has(w) && !/^\d{3,4}$/.test(w)).map(stem));

/** How much two requests are about the same thing, 0 to 1. */
export function similarity(a: string, b: string): number {
  const ta = contentWords(a), tb = contentWords(b);
  if (!ta.size || !tb.size) return 0;
  let shared = 0;
  for (const w of ta) if (tb.has(w)) shared++;
  return shared / (ta.size + tb.size - shared);
}

/** The same ask in different words: once the filler is gone, the words they share outweigh the words they do not. */
export function isNearDuplicate(a: string, b: string): boolean {
  const ta = contentWords(a), tb = contentWords(b);
  if (!ta.size || !tb.size) return false;
  let shared = 0;
  for (const w of ta) if (tb.has(w)) shared++;
  return shared >= Math.min(2, ta.size, tb.size) && shared / (ta.size + tb.size - shared) >= 0.6;
}
