import { prisma } from "../db";
import { sendReply } from "../lib/notify";
import { log } from "../lib/logger";

const INACTIVITY_HOURS = Number(process.env.SESSION_INACTIVITY_HOURS ?? 36);
const EXPIRY_DAYS = Number(process.env.SESSION_EXPIRY_DAYS ?? 90);
export const REQUEST_STALE_DAYS = Number(process.env.REQUEST_STALE_DAYS ?? 3);

export async function runSelfHealing(): Promise<void> {
  const now = Date.now();
  const cutoff = new Date(now - INACTIVITY_HOURS * 3600 * 1000);
  const stale = await prisma.session.findMany({ where: { state: "active", lastMessageAt: { lt: cutoff } } });
  for (const s of stale) {
    await prisma.session.update({ where: { id: s.id }, data: { state: "flagged" } });
    await sendReply(s.guestPhone, "Are you still with us at the hotel? Just checking in.", s.hotelId);
    log.info("self-heal: flagged inactive session", { sessionId: s.id });
  }
  const expiryCutoff = new Date(now - EXPIRY_DAYS * 86400 * 1000);
  const expired = await prisma.session.updateMany({
    where: { state: { not: "closed" }, createdAt: { lt: expiryCutoff } },
    data: { state: "closed" },
  });
  if (expired.count) log.info("self-heal: expired old sessions", { count: expired.count });

  // D-036: a request nobody has touched for days is not actionable any more. Close it as declined
  // "unactioned" so the live queue only shows current work; it stays visible in history.
  const staleCutoff = new Date(now - REQUEST_STALE_DAYS * 86400 * 1000);
  const staleReqs = await prisma.request.updateMany({
    where: { status: { in: ["received", "in_progress"] }, createdAt: { lt: staleCutoff } },
    data: { status: "resolved", declined: true, declineReason: "expired - not actioned within " + REQUEST_STALE_DAYS + " days", resolvedAt: new Date() },
  });
  if (staleReqs.count) log.info("self-heal: expired stale requests", { count: staleReqs.count, olderThanDays: REQUEST_STALE_DAYS });
}
