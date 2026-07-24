import { prisma } from "../db";
import { sendReply } from "../lib/notify";
import { log } from "../lib/logger";

const INACTIVITY_HOURS = Number(process.env.SESSION_INACTIVITY_HOURS ?? 36);
const EXPIRY_DAYS = Number(process.env.SESSION_EXPIRY_DAYS ?? 90);

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
}
