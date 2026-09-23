import { Router } from "express";
import Anthropic from "@anthropic-ai/sdk";
import { listFacts, addFact, updateFact, deleteFact, CATEGORIES } from "../knowledge/service";
import { log } from "../lib/logger";

/**
 * The hotel's knowledge base, maintained by the hotel itself from the GM console: list, add, edit,
 * switch off, delete - and "extract", where Claude turns pasted text (a brochure, the website, a few
 * paragraphs) into facts the GM approves before they are saved. Nothing here is ever specific to one hotel.
 */
export const knowledgeRouter = Router();
const ADMIN_KEY = process.env.ADMIN_API_KEY ?? "dev-admin-key";
const MODEL = process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-6";
function checkKey(req: import("express").Request): boolean { return req.header("x-admin-key") === ADMIN_KEY; }

type Proposal = { topic: string; content: string; category: string; keywords: string };
const str = (v: unknown, max: number): string => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");
function cleanProposal(v: unknown): Proposal | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const topic = str(o.topic, 80), content = str(o.content, 1200);
  if (!topic || !content) return null;
  const category = (CATEGORIES as readonly string[]).includes(String(o.category)) ? String(o.category) : "general";
  return { topic, content, category, keywords: str(o.keywords, 200) };
}

const EXTRACT_SYSTEM = [
  "You turn a hotel's own text into short facts that a concierge answers guests from.",
  "One entry per topic: check-in and check-out, Wi-Fi, breakfast, restaurant hours, room service hours, pool, gym, spa, parking, laundry, policies (smoking, pets, cancellation, children), directions, nearby places, emergency contacts, and anything else a guest might ask.",
  "Content is one to three plain sentences that keep every number, time, price, name and phone number exactly as written. Never add, guess, round or embellish; skip marketing language and anything that is not a usable fact.",
  "Category must be one of: " + CATEGORIES.join(", ") + ". Use essentials for check-in and check-out, Wi-Fi, reception hours and breakfast.",
  "Keywords: 4 to 8 words a guest might use when asking, including common Hindi or Bengali transliterations where natural (wifi, nashta, checkout, gaadi, kaise aaun).",
  "If facts already on file are provided, do not repeat them; propose only what is new or has changed.",
].join("\n");

const PROPOSE_TOOL: Anthropic.Tool = {
  name: "propose_facts",
  description: "The facts found in the hotel's text, for the GM to approve.",
  input_schema: {
    type: "object",
    properties: {
      facts: {
        type: "array",
        items: {
          type: "object",
          properties: {
            topic: { type: "string" },
            content: { type: "string" },
            category: { type: "string", enum: [...CATEGORIES] },
            keywords: { type: "string" },
          },
          required: ["topic", "content", "category"],
        },
      },
    },
    required: ["facts"],
  },
};

knowledgeRouter.get("/api/knowledge", async (req, res) => {
  if (!checkKey(req)) return res.status(401).json({ error: "unauthorized" });
  const hotelId = String(req.query.hotelId ?? "");
  if (!hotelId) return res.status(400).json({ ok: false, error: "hotelId required" });
  try { return res.json({ ok: true, data: await listFacts(hotelId, true), categories: CATEGORIES }); }
  catch (e) { return res.status(500).json({ ok: false, error: e instanceof Error ? e.message : "failed" }); }
});

knowledgeRouter.post("/api/knowledge", async (req, res) => {
  if (!checkKey(req)) return res.status(401).json({ error: "unauthorized" });
  const { hotelId, topic, content, category, keywords } = req.body ?? {};
  if (!hotelId) return res.status(400).json({ ok: false, error: "hotelId required" });
  try {
    const f = await addFact(String(hotelId), str(topic, 80), str(content, 1200), str(category, 20) || "general", str(keywords, 200));
    return f ? res.json({ ok: true, data: f }) : res.status(400).json({ ok: false, error: "A fact needs a topic and its content" });
  } catch (e) { return res.status(500).json({ ok: false, error: e instanceof Error ? e.message : "failed" }); }
});

knowledgeRouter.post("/api/knowledge/update", async (req, res) => {
  if (!checkKey(req)) return res.status(401).json({ error: "unauthorized" });
  const { hotelId, id, topic, content, category, keywords, active } = req.body ?? {};
  if (!hotelId || !id) return res.status(400).json({ ok: false, error: "hotelId and id required" });
  try {
    const f = await updateFact(String(hotelId), String(id), { topic, content, category, keywords, active: typeof active === "boolean" ? active : undefined });
    return f ? res.json({ ok: true, data: f }) : res.status(404).json({ ok: false, error: "That fact was not found" });
  } catch (e) { return res.status(500).json({ ok: false, error: e instanceof Error ? e.message : "failed" }); }
});

knowledgeRouter.post("/api/knowledge/delete", async (req, res) => {
  if (!checkKey(req)) return res.status(401).json({ error: "unauthorized" });
  const { hotelId, id } = req.body ?? {};
  if (!hotelId || !id) return res.status(400).json({ ok: false, error: "hotelId and id required" });
  try { return (await deleteFact(String(hotelId), String(id))) ? res.json({ ok: true }) : res.status(404).json({ ok: false, error: "That fact was not found" }); }
  catch (e) { return res.status(500).json({ ok: false, error: e instanceof Error ? e.message : "failed" }); }
});

/** Claude reads the hotel's text and proposes facts; nothing is saved until the GM approves. */
knowledgeRouter.post("/api/knowledge/extract", async (req, res) => {
  if (!checkKey(req)) return res.status(401).json({ error: "unauthorized" });
  const { hotelId, text } = req.body ?? {};
  const source = String(text ?? "").trim().slice(0, 12000);
  if (!hotelId) return res.status(400).json({ ok: false, error: "hotelId required" });
  if (source.length < 20) return res.status(400).json({ ok: false, error: "Paste some text about the hotel first" });
  if (!process.env.ANTHROPIC_API_KEY) return res.status(503).json({ ok: false, error: "The AI is not configured on this server" });
  try {
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const existing = await listFacts(String(hotelId));
    const onFile = existing.length ? "Facts already on file (do not repeat; propose a changed detail only if the text differs):\n" + existing.map((f) => "- " + f.topic + ": " + f.content).join("\n") + "\n\n" : "";
    const r = await client.messages.create({
      model: MODEL, max_tokens: 4000, system: EXTRACT_SYSTEM,
      messages: [{ role: "user", content: onFile + "Text from the hotel:\n" + source }],
      tools: [PROPOSE_TOOL], tool_choice: { type: "tool", name: "propose_facts" },
    });
    const call = r.content.find((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
    const raw = call && call.input && typeof call.input === "object" ? (call.input as { facts?: unknown }).facts : undefined;
    const facts = (Array.isArray(raw) ? raw : []).map(cleanProposal).filter((p): p is Proposal => p !== null).slice(0, 60);
    log.info("knowledge: extracted", { hotelId, proposed: facts.length, chars: source.length });
    return res.json({ ok: true, data: facts });
  } catch (e) {
    log.error("knowledge: extract failed", { detail: e instanceof Error ? e.message : String(e) });
    return res.status(500).json({ ok: false, error: "Could not read that text just now - try again in a moment" });
  }
});

/** Save the proposals the GM ticked. */
knowledgeRouter.post("/api/knowledge/import", async (req, res) => {
  if (!checkKey(req)) return res.status(401).json({ error: "unauthorized" });
  const { hotelId, facts } = req.body ?? {};
  if (!hotelId) return res.status(400).json({ ok: false, error: "hotelId required" });
  const list = (Array.isArray(facts) ? facts : []).map(cleanProposal).filter((p): p is Proposal => p !== null).slice(0, 60);
  try {
    let count = 0;
    for (const p of list) if (await addFact(String(hotelId), p.topic, p.content, p.category, p.keywords)) count++;
    return res.json({ ok: true, count });
  } catch (e) { return res.status(500).json({ ok: false, error: e instanceof Error ? e.message : "failed" }); }
});
