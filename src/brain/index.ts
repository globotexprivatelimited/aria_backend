import Anthropic from "@anthropic-ai/sdk";
import { BrainOutput } from "./schema";
import { buildSystemPrompt, type DeptModeMap } from "./prompt";
import { log } from "../lib/logger";

const MODEL = process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-6";
const MAX_TOKENS = Number(process.env.ANTHROPIC_MAX_TOKENS ?? 800);

let client: Anthropic | null = null;
function getClient(): Anthropic | null {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  if (!client) client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return client;
}

export function isBrainEnabled(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

/** Strip markdown fences and grab the outermost JSON object. */
function extractJson(text: string): string | null {
  const cleaned = text.replace(/```json/gi, "").replace(/```/g, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  return cleaned.slice(start, end + 1);
}

const SAFE_FALLBACK: BrainOutput = {
  requests: [],
  reply: "Thanks for your message - let me get someone from our team to help you with that right away.",
  sentiment: "neutral",
  needsHuman: true,
};

type BrainHotel = { name: string; timezone?: string | null; deptModes?: DeptModeMap; catalogText?: string; pendingText?: string };
export type BrainTurn = { role: "user" | "assistant"; content: string };
type BrainSession = { roomNumber?: string | null; claimedGuestName?: string | null; roomVerified?: boolean };

/** Earlier turns give the model the thread. Same-role turns are merged and the exchange must open with the guest. */
function buildMessages(history: BrainTurn[], message: string): Anthropic.MessageParam[] {
  const out: Anthropic.MessageParam[] = [];
  for (const t of history) {
    const content = t.content.trim();
    if (!content) continue;
    if (out.length === 0 && t.role !== "user") continue;
    const last = out[out.length - 1];
    if (last && last.role === t.role) last.content = String(last.content) + "`n" + content;
    else out.push({ role: t.role, content });
  }
  const last = out[out.length - 1];
  if (last && last.role === "user") last.content = String(last.content) + "`n" + message;
  else out.push({ role: "user", content: message });
  return out;
}

export async function understand(
  message: string,
  hotel: BrainHotel,
  session: BrainSession,
  opts: { history?: BrainTurn[] } = {}
): Promise<{ output: BrainOutput; usedFallback: boolean }> {
  const anthropic = getClient();
  if (!anthropic) {
    log.warn("brain: no API key set, using fallback");
    return { output: SAFE_FALLBACK, usedFallback: true };
  }

  const system = buildSystemPrompt(hotel, session, hotel.deptModes, hotel.catalogText, hotel.pendingText);

  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const res = await anthropic.messages.create({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        system,
        messages: buildMessages(opts.history ?? [], message),
      });

      const text = res.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join("");

      const json = extractJson(text);
      if (!json) {
        log.warn("brain: no JSON found in response", { attempt });
        continue;
      }

      const parsed = BrainOutput.safeParse(JSON.parse(json));
      if (!parsed.success) {
        log.warn("brain: response failed validation", { attempt, detail: parsed.error.issues[0]?.message });
        continue;
      }

      log.info("brain: understood", {
        requests: parsed.data.requests.length,
        sentiment: parsed.data.sentiment,
        needsHuman: parsed.data.needsHuman,
        inputTokens: res.usage.input_tokens,
        outputTokens: res.usage.output_tokens,
      });

      return { output: parsed.data, usedFallback: false };
    } catch (err) {
      log.error("brain: call failed", {
        attempt,
        detail: err instanceof Error ? err.message : String(err),
      });
      if (attempt === 2) break;
    }
  }

  return { output: SAFE_FALLBACK, usedFallback: true };
}

export { BrainOutput } from "./schema";
