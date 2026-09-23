import { prisma } from "../db";
import { log } from "../lib/logger";

/**
 * The hotel's own facts - check-in and check-out, Wi-Fi, breakfast, pool, parking, policies, directions,
 * what is nearby - written once by the hotel and handed to the brain on every message. Aria answers
 * questions about the hotel from these and from nothing else: a fact that is not here is not known.
 */

export type Fact = { id: string; topic: string; content: string; category: string; keywords: string; active: boolean; updatedAt: Date };

/** Facts marked essentials are always in front of the brain; the rest are picked by relevance when the list grows long. */
export const CATEGORIES = ["essentials", "rooms", "dining", "facilities", "policies", "directions", "nearby", "general"] as const;

const PROMPT_BUDGET_CHARS = 6000;
const PROMPT_BUDGET_FACTS = 25;

let tableReady = false;
export async function ensureKnowledgeTable(): Promise<void> {
  if (tableReady) return;
  await prisma.$executeRawUnsafe(
    "create table if not exists hotel_knowledge (id uuid primary key default gen_random_uuid(), hotel_id text not null, topic text not null, content text not null, category text not null default 'general', keywords text not null default '', active boolean not null default true, updated_at timestamptz not null default now())"
  );
  await prisma.$executeRawUnsafe("create index if not exists hotel_knowledge_hotel_idx on hotel_knowledge (hotel_id)");
  tableReady = true;
}

function rowToFact(r: any): Fact {
  return { id: String(r.id), topic: String(r.topic), content: String(r.content), category: String(r.category ?? "general"), keywords: String(r.keywords ?? ""), active: r.active !== false, updatedAt: new Date(r.updated_at) };
}

export async function listFacts(hotelId: string, includeInactive = false): Promise<Fact[]> {
  await ensureKnowledgeTable();
  const rows = await prisma.$queryRawUnsafe<any[]>(
    "select id, topic, content, category, keywords, active, updated_at from hotel_knowledge where hotel_id = $1" + (includeInactive ? "" : " and active = true") + " order by case when category = 'essentials' then 0 else 1 end, topic",
    hotelId
  );
  return rows.map(rowToFact);
}

const clean = (s: unknown, max: number): string => (typeof s === "string" ? s.replace(/\s+/g, " ").trim().slice(0, max) : "");
const validCategory = (c: unknown): string => ((CATEGORIES as readonly string[]).includes(String(c)) ? String(c) : "general");

export async function addFact(hotelId: string, topic: string, content: string, category = "general", keywords = ""): Promise<Fact | null> {
  await ensureKnowledgeTable();
  const t = clean(topic, 80), c = clean(content, 1200);
  if (!t || !c) return null;
  const rows = await prisma.$queryRawUnsafe<any[]>(
    "insert into hotel_knowledge (hotel_id, topic, content, category, keywords) values ($1, $2, $3, $4, $5) returning id, topic, content, category, keywords, active, updated_at",
    hotelId, t, c, validCategory(category), clean(keywords, 200)
  );
  return rows[0] ? rowToFact(rows[0]) : null;
}

export async function updateFact(hotelId: string, id: string, patch: { topic?: string; content?: string; category?: string; keywords?: string; active?: boolean }): Promise<Fact | null> {
  await ensureKnowledgeTable();
  const sets: string[] = [], args: unknown[] = [hotelId, id];
  const put = (col: string, v: unknown) => { args.push(v); sets.push(col + " = $" + args.length); };
  if (patch.topic !== undefined) { const t = clean(patch.topic, 80); if (t) put("topic", t); }
  if (patch.content !== undefined) { const c = clean(patch.content, 1200); if (c) put("content", c); }
  if (patch.category !== undefined) put("category", validCategory(patch.category));
  if (patch.keywords !== undefined) put("keywords", clean(patch.keywords, 200));
  if (patch.active !== undefined) put("active", !!patch.active);
  if (!sets.length) return null;
  sets.push("updated_at = now()");
  const rows = await prisma.$queryRawUnsafe<any[]>(
    "update hotel_knowledge set " + sets.join(", ") + " where hotel_id = $1 and id = $2::uuid returning id, topic, content, category, keywords, active, updated_at",
    ...args
  );
  return rows[0] ? rowToFact(rows[0]) : null;
}

export async function deleteFact(hotelId: string, id: string): Promise<boolean> {
  await ensureKnowledgeTable();
  const n = await prisma.$executeRawUnsafe("delete from hotel_knowledge where hotel_id = $1 and id = $2::uuid", hotelId, id);
  return Number(n) > 0;
}

/* ---------------------------------------------------------------- for the brain ---- */

const words = (s: string): Set<string> => new Set(s.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter((w) => w.length >= 3));

/** Everything when the list is short; otherwise the essentials plus the facts that share words with what the guest wrote. */
export function selectFacts(facts: Fact[], message: string, limit = 12): Fact[] {
  const total = facts.reduce((n, f) => n + f.topic.length + f.content.length, 0);
  if (facts.length <= PROMPT_BUDGET_FACTS && total <= PROMPT_BUDGET_CHARS) return facts;
  const q = words(message);
  const score = (f: Fact): number => {
    let s = 0;
    for (const w of words(f.topic + " " + f.keywords)) if (q.has(w)) s += 3;
    for (const w of words(f.content)) if (q.has(w)) s += 1;
    return s;
  };
  const essentials = facts.filter((f) => f.category === "essentials");
  const rest = facts.filter((f) => f.category !== "essentials").map((f) => ({ f, s: score(f) })).filter((x) => x.s > 0).sort((a, b) => b.s - a.s).slice(0, limit).map((x) => x.f);
  return [...essentials, ...rest];
}

export function renderKnowledge(facts: Fact[]): string {
  if (!facts.length) return "";
  return "HOTEL KNOWLEDGE - facts this hotel has written for you, the only source for questions about the hotel itself (timings, check-in and check-out, Wi-Fi, breakfast, pool, gym, parking, policies, directions, what is nearby). Answer from these exactly. Anything not here you do not know: say so and offer to ask the front desk - never guess a time, a price or a rule.\n" + facts.map((f) => "- " + f.topic + ": " + f.content).join("\n");
}

/** The knowledge section for one message, or an empty string when the hotel has written nothing yet. */
export async function knowledgeForPrompt(hotelId: string, message: string): Promise<string> {
  try {
    const facts = await listFacts(hotelId);
    return renderKnowledge(selectFacts(facts, message));
  } catch (err) {
    log.warn("knowledge: could not load", { hotelId, detail: err instanceof Error ? err.message : String(err) });
    return "";
  }
}
