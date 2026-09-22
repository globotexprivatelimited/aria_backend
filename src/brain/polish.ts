import Anthropic from "@anthropic-ai/sdk";
import { log } from "../lib/logger";

/**
 * The server works out the facts of a confirmation - items, totals, times - so they are exact; Claude then
 * rewrites the whole message in its own voice and the guest's language. Every number in the draft must
 * survive the rewrite and no new price may appear, otherwise the exact draft is sent instead.
 */
const MODEL = process.env.ANTHROPIC_POLISH_MODEL ?? "claude-haiku-4-5-20251001";
let client: Anthropic | null = null;

const SYSTEM = [
  "You rewrite a hotel concierge's WhatsApp reply so it reads as one natural message from a warm, sharp host - never a form letter.",
  "Keep every fact exactly: each item, quantity, price, total, date, time, room number and team stays, with the same numbers written as digits 0-9.",
  "Add nothing that is not in the draft: no new promise, price, time, dish or suggestion.",
  "Write in the language and style the guest used - Hindi, Bengali, English or a mix, in the same script. Keep it short: WhatsApp, not email. At most one emoji.",
  "A list of ordered items may stay as short lines. Return only the message, nothing else.",
].join("\n");

const digits = (s: string) => (s.match(/\d+(?:[.,]\d+)*/g) ?? []).map((d) => d.replace(/,/g, ""));
const rupees = (s: string) => Array.from(s.matchAll(/\u20B9\s?(\d[\d,]*)/g)).map((m) => (m[1] ?? "").replace(/,/g, ""));

/** True when the rewrite kept every number of the draft and invented no price. */
export function keepsTheFacts(draft: string, polished: string): boolean {
  const have = new Set(digits(polished));
  if (!digits(draft).every((d) => have.has(d))) return false;
  const allowed = new Set(rupees(draft));
  return rupees(polished).every((r) => allowed.has(r));
}

/** Claude's voice on the server's facts; the exact draft whenever the rewrite fails or changes a number. */
export async function polishReply(draft: string, guestMessage: string): Promise<string> {
  if (!process.env.ANTHROPIC_API_KEY || !draft.trim()) return draft;
  if (!client) client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  try {
    const res = await client.messages.create({ model: MODEL, max_tokens: 500, system: SYSTEM, messages: [{ role: "user", content: "The guest wrote: " + guestMessage + "\n\nDraft reply:\n" + draft }] }, { timeout: 6000, maxRetries: 0 });
    const text = res.content.filter((b): b is Anthropic.TextBlock => b.type === "text").map((b) => b.text).join("").trim();
    if (!text || text.length > draft.length * 2 + 300) return draft;
    if (!keepsTheFacts(draft, text)) {
      log.warn("polish: rewrite changed a fact - sending the exact draft", { draft: draft.slice(0, 200), polished: text.slice(0, 200) });
      return draft;
    }
    return text;
  } catch (err) {
    log.warn("polish: rewrite failed - sending the exact draft", { detail: err instanceof Error ? err.message : String(err) });
    return draft;
  }
}
