import "dotenv/config";
import { prisma } from "../db";

/**
 * How long guests wait: every inbound message paired with the next outbound to the same guest within two minutes.
 * Usage: pnpm latency [hotelId] [days]   - median, p90 and the slowest replies, from the database, nothing simulated.
 */
async function main(): Promise<void> {
  const hotelId = process.argv[2] && process.argv[2] !== "all" ? process.argv[2] : null;
  const days = Number(process.argv[3] ?? 7);
  const since = new Date(Date.now() - days * 86400000);
  const rows = await prisma.message.findMany({ where: { ...(hotelId ? { hotelId } : {}), createdAt: { gt: since } }, orderBy: { createdAt: "asc" }, select: { hotelId: true, guestPhone: true, direction: true, createdAt: true, body: true } });
  const pairs: { ms: number; text: string; at: Date }[] = [];
  const pendingIn = new Map<string, { at: Date; text: string }>();
  for (const m of rows) {
    const key = m.hotelId + "|" + m.guestPhone;
    if (m.direction === "inbound") { pendingIn.set(key, { at: m.createdAt, text: m.body ?? "" }); continue; }
    const q = pendingIn.get(key);
    if (!q) continue;
    const ms = m.createdAt.getTime() - q.at.getTime();
    if (ms >= 0 && ms <= 120000) pairs.push({ ms, text: q.text.slice(0, 60), at: q.at });
    pendingIn.delete(key);
  }
  if (!pairs.length) { console.log("no replies in the last " + days + " day(s)" + (hotelId ? " for hotel " + hotelId : "")); return; }
  const sorted = pairs.map((p) => p.ms).sort((a, b) => a - b);
  const pick = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
  console.log("replies measured: " + pairs.length + " (last " + days + " day(s)" + (hotelId ? ", hotel " + hotelId : ", all hotels") + ")");
  console.log("median " + (pick(0.5) / 1000).toFixed(1) + " s | p90 " + (pick(0.9) / 1000).toFixed(1) + " s | max " + (sorted[sorted.length - 1] / 1000).toFixed(1) + " s | under 10 s: " + Math.round((sorted.filter((x) => x < 10000).length / sorted.length) * 100) + "%");
  console.log("slowest:");
  for (const p of [...pairs].sort((a, b) => b.ms - a.ms).slice(0, 5)) console.log("  " + (p.ms / 1000).toFixed(1) + " s  " + p.at.toISOString() + "  " + JSON.stringify(p.text));
}

main().catch((e) => { console.error(e instanceof Error ? e.message : String(e)); process.exitCode = 1; }).finally(() => process.exit());
