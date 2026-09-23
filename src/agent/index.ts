import Anthropic from "@anthropic-ai/sdk";
import { AGENT_TOOLS, runTool, type AgentContext, type DoneAction } from "./tools";
import { prisma } from "../db";
import { buildAgentPrompt } from "./prompt";
import { guardModelReply, verifyReply, type Catalog } from "../menu/catalog";
import type { BrainOutput } from "../brain/schema";
import type { BrainTurn } from "../brain";
import { log } from "../lib/logger";

/**
 * The agent brain (ARIA_BRAIN=agent). Claude reads the live hotel from its prompt, acts through tools that
 * check everything against the catalogue and the live availability, sees what they did, and writes every
 * word the guest reads. The server never composes a sentence; it only refuses what is not real.
 */

const MODEL = process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-6";
const MAX_TOKENS = Number(process.env.ANTHROPIC_MAX_TOKENS ?? 1200);
const MAX_STEPS = 4;
const FALLBACK = "Thanks for your message - let me get someone from our team to help you with that right away.";

let client: Anthropic | null = null;
function getClient(): Anthropic | null {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  if (!client) client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return client;
}

export function useAgent(): boolean {
  return (process.env.ARIA_BRAIN ?? "").toLowerCase() === "agent";
}

type AgentHotel = { hotelId: string; name: string; timezone?: string | null };
type AgentSession = { roomNumber?: string | null; claimedGuestName?: string | null; roomVerified?: boolean };
type AgentOpts = { deptModes?: Record<string, string>; contextText?: string; history?: BrainTurn[]; guestPhone: string; dryRun?: boolean; doneAlready?: DoneAction[] };
export type AgentResult = { output: BrainOutput; usedFallback: boolean; steps: number };

/** Earlier turns give the thread. Same-role turns are merged and the exchange must open with the guest. */
function buildMessages(history: BrainTurn[], message: string): Anthropic.MessageParam[] {
  const out: Anthropic.MessageParam[] = [];
  for (const t of history) {
    const content = t.content.trim();
    if (!content) continue;
    if (out.length === 0 && t.role !== "user") continue;
    const last = out[out.length - 1];
    if (last && last.role === t.role) last.content = String(last.content) + "\n" + content;
    else out.push({ role: t.role, content });
  }
  const last = out[out.length - 1];
  if (last && last.role === "user") last.content = String(last.content) + "\n" + message;
  else out.push({ role: "user", content: message });
  return out;
}

type Block = Anthropic.TextBlockParam | Anthropic.ToolUseBlockParam;
function toParam(b: Anthropic.ContentBlock): Block | null {
  if (b.type === "text") return { type: "text", text: b.text };
  if (b.type === "tool_use") return { type: "tool_use", id: b.id, name: b.name, input: b.input };
  return null;
}

/** What is already with the teams for this guest today - so the brain answers "how long?" instead of filing it again. */
async function loadDoneAlready(hotelId: string, guestPhone: string): Promise<DoneAction[]> {
  try {
    const rows = await prisma.request.findMany({ where: { hotelId, guestPhone, createdAt: { gt: new Date(Date.now() - 12 * 60 * 60 * 1000) }, resolvedAt: null, declined: false }, orderBy: { createdAt: "desc" }, take: 12 });
    return rows.map((r) => ({ intent: String(r.intent ?? "concierge"), detail: r.requestDetail ?? "", minutesAgo: Math.round((Date.now() - new Date(r.createdAt).getTime()) / 60000), status: String(r.status) })).filter((d) => d.detail);
  } catch (err) {
    log.warn("agent: could not load earlier requests", { detail: err instanceof Error ? err.message : String(err) });
    return [];
  }
}

function doneText(done: DoneAction[]): string {
  if (!done.length) return "";
  return "\n\nALREADY DONE FOR THIS GUEST (with the teams now - never file, order or book these again; when asked how long or where it is, answer from here):" + done.map((d) => "\n- " + d.detail + " (" + (d.minutesAgo < 1 ? "just now" : d.minutesAgo + " min ago") + ", " + d.status + ")").join("");
}

/** The spa's usual hours with end times, so "until when is the spa open" has an answer. */
function spaHoursText(catalog: Catalog): string {
  const lines: string[] = [];
  for (const item of catalog.items.filter((i) => i.dept === "spa")) {
    const mine = catalog.slots.filter((s) => s.dept === "spa" && s.active && (s.itemId === item.id || s.itemId === null));
    if (!mine.length) continue;
    lines.push("- " + item.name + ": " + mine.map((s) => String(s.startTime).slice(0, 5) + (s.endTime ? " to " + String(s.endTime).slice(0, 5) : "") + (s.days.length === 7 ? ", every day" : s.days.length ? ", " + s.days.join("/") : "") + " (" + s.capacity + " at a time)").join("; "));
  }
  return lines.length ? "\n\nSPA HOURS (the usual schedule - answer questions about opening and closing times from this; what is actually free comes only from get_spa_slots):\n" + lines.join("\n") : "";
}

export async function runAgent(message: string, hotel: AgentHotel, session: AgentSession, catalog: Catalog, opts: AgentOpts): Promise<AgentResult> {
  const ctx: AgentContext = {
    hotelId: hotel.hotelId, catalog, room: session.roomNumber ?? null, guestName: session.claimedGuestName ?? null,
    guestPhone: opts.guestPhone, deptModes: opts.deptModes ?? {}, dryRun: !!opts.dryRun, filed: [],
    doneAlready: opts.doneAlready ?? (await loadDoneAlready(hotel.hotelId, opts.guestPhone)),
  };
  const finish = (reply: string, usedFallback: boolean, steps: number): AgentResult => ({
    output: { requests: ctx.filed, reply, sentiment: "neutral", needsHuman: usedFallback || ctx.filed.some((r) => r.priority === "human_required" || r.priority === "emergency") },
    usedFallback, steps,
  });
  const anthropic = getClient();
  if (!anthropic) { log.warn("agent: no API key set, using fallback"); return finish(FALLBACK, true, 0); }

  const system = buildAgentPrompt(hotel, session, ctx.deptModes, catalog.promptText, (opts.contextText ?? "") + doneText(ctx.doneAlready) + spaHoursText(catalog));
  const messages = buildMessages(opts.history ?? [], message);
  try {
    for (let step = 1; step <= MAX_STEPS; step++) {
      // on the last step the model must answer in words, whatever it still wanted to do
      const last = step === MAX_STEPS;
      const res = await anthropic.messages.create({
        model: MODEL, max_tokens: MAX_TOKENS, system, messages, tools: AGENT_TOOLS,
        ...(last ? { tool_choice: { type: "none" } as unknown as Anthropic.ToolChoice } : {}),
      });
      const text = res.content.filter((b): b is Anthropic.TextBlock => b.type === "text").map((b) => b.text).join("").trim();
      const calls = res.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
      if (res.stop_reason !== "tool_use" || calls.length === 0) {
        const reply = guardModelReply(verifyReply(text, catalog), catalog).trim();
        log.info("agent: replied", { steps: step, filed: ctx.filed.length, inputTokens: res.usage.input_tokens, outputTokens: res.usage.output_tokens });
        return finish(reply || FALLBACK, !reply, step);
      }
      messages.push({ role: "assistant", content: res.content.map(toParam).filter((b): b is Block => b !== null) });
      const results: Anthropic.ToolResultBlockParam[] = [];
      for (const call of calls) {
        const input = (call.input && typeof call.input === "object" ? call.input : {}) as Record<string, unknown>;
        const out = await runTool(call.name, input, ctx);
        log.info("agent: tool", { name: call.name, ok: (out as { ok?: unknown }).ok === true });
        results.push({ type: "tool_result", tool_use_id: call.id, content: JSON.stringify(out) });
      }
      messages.push({ role: "user", content: results });
    }
  } catch (err) {
    log.error("agent: failed", { detail: err instanceof Error ? err.message : String(err) });
  }
  return finish(FALLBACK, true, MAX_STEPS);
}
