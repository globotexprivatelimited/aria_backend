import Anthropic from "@anthropic-ai/sdk";
import { BrainOutput, INTENTS, PRIORITIES } from "./schema";
import { buildSystemPrompt, type DeptModeMap } from "./prompt";
import { log } from "../lib/logger";

const MODEL = process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-6";
const MAX_TOKENS = Number(process.env.ANTHROPIC_MAX_TOKENS ?? 1200);

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

/** JSON as the model wrote it; if a raw line break slipped inside a string, escape it and read it again. */
export function parseLoose(json: string): unknown {
  try {
    return JSON.parse(json);
  } catch {
    let out = "", inStr = false, esc = false;
    for (const ch of json) {
      if (!inStr) { if (ch === '"') inStr = true; out += ch; continue; }
      if (esc) { out += ch; esc = false; continue; }
      if (ch === "\\") { out += ch; esc = true; continue; }
      if (ch === '"') { inStr = false; out += ch; continue; }
      out += ch === "\n" ? "\\n" : ch === "\r" ? "" : ch === "\t" ? "\\t" : ch;
    }
    return JSON.parse(out);
  }
}

/** Claude answers by calling this tool, so the API itself guarantees a structured answer - never loose text to parse. */
const RESPOND_TOOL: Anthropic.Tool = {
  name: "respond",
  description: "Send Aria's WhatsApp reply to the guest and file whatever the guest newly asked the hotel to do. Call this exactly once for every guest message.",
  input_schema: {
    type: "object",
    properties: {
      requests: {
        type: "array",
        description: "What the guest newly asked the hotel to do in this message. Empty when they only asked a question or chatted.",
        items: {
          type: "object",
          properties: {
            intent: { type: "string", enum: [...INTENTS] },
            detail: { type: "string", description: "What exactly is wanted, including any preference in the guest's own words" },
            priority: { type: "string", enum: [...PRIORITIES] },
            quantity: { type: "integer" },
            whenText: { type: "string", description: "The date and time exactly as the guest said it" },
            items: { type: "array", items: { type: "object", properties: { id: { type: "string" }, name: { type: "string" }, qty: { type: "integer" } }, required: ["name"] } },
            notOnMenu: { type: "array", items: { type: "string" } },
          },
          required: ["intent", "detail"],
        },
      },
      reply: { type: "string", description: "The WhatsApp message to the guest, in their language" },
      showMenu: { type: "string", enum: ["fb", "spa"], description: "Only for a bare request for the whole menu" },
      answeredMenu: { type: "boolean", description: "True when your reply itself answers a menu or recommendation question" },
      sentiment: { type: "string", enum: ["happy", "neutral", "unhappy"] },
      needsHuman: { type: "boolean" },
    },
    required: ["requests", "reply", "sentiment", "needsHuman"],
  },
};

const SAFE_FALLBACK: BrainOutput = {
  requests: [],
  reply: "Let me get one of our team on this for you \u2014 someone will be with you shortly.",
  sentiment: "neutral",
  needsHuman: true,
};

type BrainHotel = { name: string; timezone?: string | null; deptModes?: DeptModeMap; catalogText?: string; pendingText?: string; contextText?: string };
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

  const system = buildSystemPrompt(hotel, session, hotel.deptModes, hotel.catalogText, hotel.pendingText, hotel.contextText);

  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const res = await anthropic.messages.create({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        system,
        messages: buildMessages(opts.history ?? [], message),
        tools: [RESPOND_TOOL],
        tool_choice: { type: "tool", name: "respond" },
      });

      const text = res.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join("");

      const call = res.content.find((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
      const json = call ? JSON.stringify(call.input) : extractJson(text);
      if (!json) {
        log.warn("brain: no JSON found in response", { attempt });
        continue;
      }

      const parsed = BrainOutput.safeParse(parseLoose(json));
      if (!parsed.success) {
        log.warn("brain: response failed validation", { attempt, detail: parsed.error.issues[0]?.message, path: parsed.error.issues[0]?.path?.join(".") });
        continue;
      }

      log.info("brain: understood", {
        requests: parsed.data.requests.length,
        sentiment: parsed.data.sentiment,
        needsHuman: parsed.data.needsHuman,
        via: call ? "tool" : "text",
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
