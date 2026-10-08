import { readFileSync, existsSync } from "fs";

/**
 * pnpm ai:cost [days] - what Claude cost per hotel, per purpose and per day (pending item 18), read from the ai_usage
 * table the API writes. Uses DATABASE_URL from the environment or this folder's .env; never prints it.
 */
function loadDotEnv(): void {
  if (!existsSync(".env")) return;
  for (const line of readFileSync(".env", "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}
const usd = (x: number): string => "$" + (x >= 1 ? x.toFixed(2) : x.toFixed(4));
const k = (x: number): string => (x >= 1_000_000 ? (x / 1_000_000).toFixed(2) + "M" : x >= 1_000 ? (x / 1_000).toFixed(1) + "k" : String(x));
const pad = (s: string, w: number): string => (s.length >= w ? s + " " : s + " ".repeat(w - s.length));

async function main(): Promise<void> {
  loadDotEnv();
  const days = Math.max(1, Number(process.argv[2] ?? 30) || 30);
  const { usageReport } = await import("../lib/aiUsage");
  const { prisma } = await import("../db");
  try {
    const r = await usageReport(days);
    console.log("Claude cost over the last " + r.days + " day(s), since " + r.since.slice(0, 10));
    console.log("total: " + r.total.calls + " calls, " + k(r.total.inputTokens) + " in, " + k(r.total.outputTokens) + " out, " + k(r.total.cacheReadTokens) + " cache read, " + k(r.total.cacheWriteTokens) + " cache write - " + usd(r.total.costUsd));
    console.log("");
    console.log(pad("hotel", 40) + pad("calls", 8) + pad("guest msgs", 12) + pad("cost", 12) + "per guest msg");
    for (const h of r.byHotel) console.log(pad(h.hotelId ?? "(no hotel - scheduled jobs)", 40) + pad(String(h.calls), 8) + pad(h.guestMessages == null ? "-" : String(h.guestMessages), 12) + pad(usd(h.costUsd), 12) + (h.costPerGuestMessageUsd == null ? "-" : usd(h.costPerGuestMessageUsd)));
    console.log("");
    console.log(pad("purpose", 12) + pad("model", 30) + pad("calls", 8) + pad("in", 10) + pad("out", 10) + pad("cache rd", 10) + pad("cache wr", 10) + "cost");
    for (const p of r.byPurpose) console.log(pad(p.purpose, 12) + pad(p.model, 30) + pad(String(p.calls), 8) + pad(k(p.inputTokens), 10) + pad(k(p.outputTokens), 10) + pad(k(p.cacheReadTokens), 10) + pad(k(p.cacheWriteTokens), 10) + usd(p.costUsd));
    console.log("");
    console.log(pad("day", 12) + pad("calls", 8) + "cost");
    for (const d of r.byDay) console.log(pad(d.day, 12) + pad(String(d.calls), 8) + usd(d.costUsd));
    if (r.unpricedModels.length) console.log("\nno price on record for: " + r.unpricedModels.join(", ") + " - add it to PRICES in src/lib/aiUsage.ts");
    if (!r.total.calls) console.log("\nnothing recorded yet - the API records calls from the deploy that added this onward");
  } finally {
    await (prisma as unknown as { $disconnect?: () => Promise<void> }).$disconnect?.();
  }
}
main().catch((e) => { console.error("ai:cost failed - " + (e instanceof Error ? e.message : String(e))); process.exit(1); });
