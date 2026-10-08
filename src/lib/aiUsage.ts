import Anthropic from "@anthropic-ai/sdk";
import { AsyncLocalStorage } from "async_hooks";
import type { Request, Response, NextFunction } from "express";
import { prisma } from "../db";

/**
 * What every Claude call costs (pending item 18). Each call made through meteredClaude() is written to ai_usage with
 * its hotel, purpose, model, tokens and the price in US dollars, after the reply has been handed back - recording never
 * delays or breaks a reply. usageReport() and `pnpm ai:cost` turn the rows into cost per hotel, per purpose and per day.
 */

/** US dollars per million tokens - https://platform.claude.com/docs/en/about-claude/pricing, checked 8 Oct 2026. */
export const PRICES: Record<string, { input: number; output: number; cacheWrite: number; cacheRead: number }> = {
  "claude-sonnet-4-6": { input: 3, output: 15, cacheWrite: 3.75, cacheRead: 0.3 },
  "claude-sonnet-4-5": { input: 3, output: 15, cacheWrite: 3.75, cacheRead: 0.3 },
  "claude-haiku-4-5": { input: 1, output: 5, cacheWrite: 1.25, cacheRead: 0.1 },
};

/** The price for a model id, dated ids included (claude-haiku-4-5-20251001 is claude-haiku-4-5); null for a model not in the table. */
export function priceFor(model: string): (typeof PRICES)[string] | null {
  const m = String(model ?? "");
  const key = Object.keys(PRICES).sort((a, b) => b.length - a.length).find((k) => m === k || m.startsWith(k + "-") || m.startsWith(k + "@"));
  return key ? PRICES[key] : null;
}

export type Usage = { input_tokens?: number | null; output_tokens?: number | null; cache_creation_input_tokens?: number | null; cache_read_input_tokens?: number | null };
const n = (x: unknown): number => (typeof x === "number" && Number.isFinite(x) && x > 0 ? Math.round(x) : 0);

/** The call's price in US dollars; null when the model has no price in the table (its tokens are still recorded). */
export function costUsd(model: string, u: Usage): number | null {
  const p = priceFor(model);
  if (!p) return null;
  return (n(u.input_tokens) * p.input + n(u.output_tokens) * p.output + n(u.cache_creation_input_tokens) * p.cacheWrite + n(u.cache_read_input_tokens) * p.cacheRead) / 1_000_000;
}

/* ---- which hotel the current work is for ---- */
const scope = new AsyncLocalStorage<{ hotelId: string | null }>();

/** Express middleware for /api: the hotel a request names (tenantGuard has already set a GM's own) is the hotel its Claude calls are charged to. */
export function usageScope(req: Request, _res: Response, next: NextFunction): void {
  const q = (req.query ?? {}) as Record<string, unknown>;
  const b = (req.body && typeof req.body === "object" ? req.body : {}) as Record<string, unknown>;
  const h = q.hotelId ?? b.hotelId;
  scope.run({ hotelId: h ? String(h) : null }, next);
}

/**
 * Charges the rest of this piece of work - a guest message being answered - to this hotel. It always starts a fresh
 * record and never edits one that other work may share, so two hotels answered at the same time never swap charges.
 */
export function usageForHotel(hotelId: string | null | undefined): void {
  if (hotelId) scope.enterWith({ hotelId: String(hotelId) });
}

/* ---- recording ---- */
let table: Promise<void> | null = null;
function ensureTable(): Promise<void> {
  if (!table) {
    table = prisma.$executeRawUnsafe(
      "create table if not exists ai_usage (id bigserial primary key, created_at timestamptz not null default now(), hotel_id text, purpose text not null, model text not null, input_tokens integer not null default 0, output_tokens integer not null default 0, cache_write_tokens integer not null default 0, cache_read_tokens integer not null default 0, cost_usd numeric(14,8))")
      .then(() => prisma.$executeRawUnsafe("create index if not exists ai_usage_hotel_time on ai_usage (hotel_id, created_at)"))
      .then(() => undefined, (e: unknown) => { table = null; throw e; });
  }
  return table;
}

let warned = false;
/** Writes one call to ai_usage. Never throws: a failed write is reported once in the log and the reply goes on. */
export async function recordUsage(purpose: string, model: string, usage: Usage, hotelId: string | null): Promise<void> {
  try {
    await ensureTable();
    await prisma.$executeRawUnsafe(
      "insert into ai_usage (hotel_id, purpose, model, input_tokens, output_tokens, cache_write_tokens, cache_read_tokens, cost_usd) values ($1,$2,$3,$4,$5,$6,$7,$8)",
      hotelId, purpose, model, n(usage.input_tokens), n(usage.output_tokens), n(usage.cache_creation_input_tokens), n(usage.cache_read_input_tokens), costUsd(model, usage));
  } catch (e) {
    if (!warned) { warned = true; console.warn("ai usage: could not record a Claude call - " + (e instanceof Error ? e.message : String(e))); }
  }
}

type Create = (body: Record<string, unknown>, options?: unknown) => Promise<unknown>;

/**
 * A Claude client whose every messages.create is recorded. The caller gets back exactly what the SDK returned - the
 * same promise - and the usage is written once it resolves, charged to the hotel of the work that made the call.
 */
export function meteredClaude(purpose: string): Anthropic {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const messages = client.messages as unknown as { create: Create };
  const create: Create = messages.create.bind(messages);
  messages.create = (body, options) => {
    const hotelId = scope.getStore()?.hotelId ?? null;
    const reply = create(body, options);
    if (!body?.stream) reply.then((res) => {
      const r = res as { usage?: Usage; model?: string } | null;
      if (r?.usage) void recordUsage(purpose, String(r.model ?? body?.model ?? ""), r.usage, hotelId);
    }, () => undefined);
    return reply;
  };
  return client;
}

/* ---- the report ---- */
export type UsageTotals = { calls: number; inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number; costUsd: number; unpricedCalls: number };
export type UsageReport = {
  days: number; since: string; total: UsageTotals;
  byHotel: (UsageTotals & { hotelId: string | null; guestMessages: number | null; costPerGuestMessageUsd: number | null })[];
  byPurpose: (UsageTotals & { purpose: string; model: string })[];
  byDay: (UsageTotals & { day: string })[];
  unpricedModels: string[];
};
const COLS = "count(*)::int as calls, coalesce(sum(input_tokens),0)::float8 as input, coalesce(sum(output_tokens),0)::float8 as output, coalesce(sum(cache_read_tokens),0)::float8 as cache_read, coalesce(sum(cache_write_tokens),0)::float8 as cache_write, coalesce(sum(cost_usd),0)::float8 as cost, (count(*) filter (where cost_usd is null))::int as unpriced";
const totals = (r: Record<string, unknown>): UsageTotals => ({
  calls: Number(r.calls ?? 0), inputTokens: Number(r.input ?? 0), outputTokens: Number(r.output ?? 0), cacheReadTokens: Number(r.cache_read ?? 0),
  cacheWriteTokens: Number(r.cache_write ?? 0), costUsd: Math.round(Number(r.cost ?? 0) * 1e6) / 1e6, unpricedCalls: Number(r.unpriced ?? 0),
});

/** Cost of Claude over the last `days` days: per hotel (with the guest messages it answered), per purpose and model, per day. */
export async function usageReport(days = 30): Promise<UsageReport> {
  await ensureTable();
  const d = Math.min(366, Math.max(1, Math.floor(Number(days) || 30)));
  const since = new Date(Date.now() - d * 86_400_000);
  const q = <T>(sql: string): Promise<T[]> => prisma.$queryRawUnsafe<T[]>(sql, since);
  const [all, hotels, purposes, perDay, unpriced] = await Promise.all([
    q<Record<string, unknown>>("select " + COLS + " from ai_usage where created_at >= $1"),
    q<Record<string, unknown>>("select hotel_id, " + COLS + " from ai_usage where created_at >= $1 group by hotel_id order by cost desc"),
    q<Record<string, unknown>>("select purpose, model, " + COLS + " from ai_usage where created_at >= $1 group by purpose, model order by cost desc"),
    q<Record<string, unknown>>("select to_char(date_trunc('day', created_at), 'YYYY-MM-DD') as day, " + COLS + " from ai_usage where created_at >= $1 group by 1 order by 1"),
    q<{ model: string }>("select distinct model from ai_usage where created_at >= $1 and cost_usd is null"),
  ]);
  let guest: Map<string, number> | null = null;
  try {
    const rows = await q<{ hotel_id: string; n: number }>("select \"hotelId\" as hotel_id, count(*)::int as n from \"Message\" where direction = 'inbound' and \"createdAt\" >= $1 group by 1");
    guest = new Map(rows.map((r) => [String(r.hotel_id), Number(r.n)]));
  } catch { /* the guest-message count is a nice-to-have; the costs stand without it */ }
  return {
    days: d, since: since.toISOString(), total: totals(all[0] ?? {}),
    byHotel: hotels.map((r) => {
      const t = totals(r); const hotelId = r.hotel_id == null ? null : String(r.hotel_id);
      const msgs = guest && hotelId ? guest.get(hotelId) ?? 0 : null;
      return { hotelId, ...t, guestMessages: msgs, costPerGuestMessageUsd: msgs ? Math.round((t.costUsd / msgs) * 1e6) / 1e6 : null };
    }),
    byPurpose: purposes.map((r) => ({ purpose: String(r.purpose), model: String(r.model), ...totals(r) })),
    byDay: perDay.map((r) => ({ day: String(r.day), ...totals(r) })),
    unpricedModels: unpriced.map((r) => String(r.model)),
  };
}
