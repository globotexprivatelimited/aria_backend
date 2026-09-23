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
/** A cheaper second model reads each reply against the only material the brain was given. Set to "off" to disable. */
const CHECK_MODEL = process.env.ANTHROPIC_CHECK_MODEL ?? "claude-haiku-4-5-20251001";
const FALLBACK = "Let me get one of our team on this for you \u2014 someone will be with you shortly.";

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

const words = (s: string): Set<string> => new Set(s.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter((w) => w.length >= 2));

/** The reply says what Aria already said: near-identical to one of her last three messages to this guest. */
export function repeatsEarlier(reply: string, history: BrainTurn[]): string | null {
  const mine = words(reply);
  if (mine.size < 6) return null;
  const earlier = history.filter((t) => t.role === "assistant").slice(-3);
  for (const t of earlier) {
    const theirs = words(t.content);
    if (theirs.size < 6) continue;
    let shared = 0;
    for (const w of mine) if (theirs.has(w)) shared++;
    if (shared / (mine.size + theirs.size - shared) >= 0.7) return t.content;
  }
  return null;
}

const CHECK_TOOL: Anthropic.Tool = {
  name: "report",
  description: "Claims in the reply that the material does not support.",
  input_schema: { type: "object", properties: { unsupported: { type: "array", items: { type: "string" }, description: "each unsupported claim, quoted briefly, in the reply's own words; empty when everything is supported" } }, required: ["unsupported"] },
};
const CHECK_SYSTEM = [
  "You check a hotel concierge's reply against the only material the concierge was allowed to use: the hotel's own information (menu, spa schedule, knowledge, weather, what is already done) plus the tool results of this turn, plus what the guest themselves said.",
  "List every specific claim in the reply that this material does not support: a time, an opening hour, a price, an availability, a duration, a distance, a policy, a facility, a place, a promise that something was done.",
  "Arithmetic on given facts is supported (a 60-minute treatment from 3 pm ends at 4 pm). Polite phrasing, questions, apologies, and offers to ask the team are not claims. Restating what the guest said is supported.",
  "Return an empty list when everything is supported. Be strict about facts and generous about wording.",
].join("\n");

/** Anything in the reply the material does not back up. Empty on any failure - a broken check must never block a reply. */
async function unsupportedClaims(anthropic: Anthropic, material: string, guestSaid: string, reply: string): Promise<string[]> {
  if (CHECK_MODEL.toLowerCase() === "off" || reply.length < 40) return [];
  try {
    const res = await anthropic.messages.create({
      model: CHECK_MODEL, max_tokens: 400, system: CHECK_SYSTEM,
      messages: [{ role: "user", content: "MATERIAL:\n" + material + "\n\nGUEST SAID:\n" + guestSaid + "\n\nREPLY TO CHECK:\n" + reply }],
      tools: [CHECK_TOOL], tool_choice: { type: "tool", name: "report" },
    });
    const call = res.content.find((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
    const raw = call && call.input && typeof call.input === "object" ? (call.input as { unsupported?: unknown }).unsupported : undefined;
    return (Array.isArray(raw) ? raw : []).map((x) => String(x).trim()).filter(Boolean).slice(0, 6);
  } catch (err) {
    log.warn("agent: fact check failed", { detail: err instanceof Error ? err.message : String(err) });
    return [];
  }
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
  const toolResults: string[] = [];
  const guestSaid = messages.filter((m) => m.role === "user" && typeof m.content === "string").map((m) => String(m.content)).join("\n");
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
        let reply = guardModelReply(verifyReply(text, catalog), catalog).trim();
        // said once, and only what the hotel's material supports: a repeat or an unsupported claim gets one rewrite
        const repeated = repeatsEarlier(reply, opts.history ?? []);
        const unsupported = await unsupportedClaims(anthropic, system + (toolResults.length ? "\n\nTOOL RESULTS THIS TURN:\n" + toolResults.join("\n") : ""), guestSaid, reply);
        if (reply && (repeated || unsupported.length)) {
          const problems = [
            repeated ? "It repeats what you already told the guest: \"" + repeated.slice(0, 300) + "\". Say only what is new, or acknowledge in a few words." : "",
            unsupported.length ? "These details are not in the hotel's information or the tool results: " + unsupported.map((u) => "\"" + u + "\"").join(", ") + ". Drop or correct them; if you do not have a detail, say so and offer to ask the front desk." : "",
          ].filter(Boolean).join("\n");
          try {
            const again = await anthropic.messages.create({
              model: MODEL, max_tokens: MAX_TOKENS, system,
              messages: [...messages, { role: "assistant", content: reply }, { role: "user", content: "REVISE YOUR LAST REPLY. Problems:\n" + problems + "\nWrite the reply again in the same language and script, keeping everything that was fine. Do not call tools. Reply with the message text only." }],
              tools: AGENT_TOOLS, tool_choice: { type: "none" } as unknown as Anthropic.ToolChoice,
            });
            const revised = guardModelReply(verifyReply(again.content.filter((b): b is Anthropic.TextBlock => b.type === "text").map((b) => b.text).join("").trim(), catalog), catalog).trim();
            log.info("agent: revised", { repeated: !!repeated, unsupported });
            if (revised) reply = revised;
          } catch (err) {
            log.warn("agent: revision failed, sending the draft", { detail: err instanceof Error ? err.message : String(err) });
          }
        }
        log.info("agent: replied", { steps: step, filed: ctx.filed.length, inputTokens: res.usage.input_tokens, outputTokens: res.usage.output_tokens });
        return finish(reply || FALLBACK, !reply, step);
      }
      messages.push({ role: "assistant", content: res.content.map(toParam).filter((b): b is Block => b !== null) });
      const results: Anthropic.ToolResultBlockParam[] = [];
      for (const call of calls) {
        const input = (call.input && typeof call.input === "object" ? call.input : {}) as Record<string, unknown>;
        const out = await runTool(call.name, input, ctx);
        log.info("agent: tool", { name: call.name, ok: (out as { ok?: unknown }).ok === true });
        toolResults.push(call.name + ": " + JSON.stringify(out));
        results.push({ type: "tool_result", tool_use_id: call.id, content: JSON.stringify(out) });
      }
      messages.push({ role: "user", content: results });
    }
  } catch (err) {
    log.error("agent: failed", { detail: err instanceof Error ? err.message : String(err) });
  }
  return finish(FALLBACK, true, MAX_STEPS);
}
