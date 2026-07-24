import { prisma } from "../db";
import { log } from "../lib/logger";

const MESSAGE_RETENTION_DAYS = Number(process.env.MESSAGE_RETENTION_DAYS ?? 365);
const CLOSED_SESSION_RETENTION_DAYS = Number(process.env.SESSION_RETENTION_DAYS ?? 400);

export async function runRetentionPurge(): Promise<void> {
  const msgCutoff = new Date(Date.now() - MESSAGE_RETENTION_DAYS * 86400 * 1000);
  const oldMessages = await prisma.message.deleteMany({ where: { createdAt: { lt: msgCutoff } } });
  if (oldMessages.count) log.info("retention: deleted messages past retention", { count: oldMessages.count });

  const sessCutoff = new Date(Date.now() - CLOSED_SESSION_RETENTION_DAYS * 86400 * 1000);
  const oldSessions = await prisma.session.updateMany({
    where: { state: "closed", createdAt: { lt: sessCutoff } },
    data: { claimedGuestName: null },
  });
  if (oldSessions.count) log.info("retention: anonymised closed sessions", { count: oldSessions.count });
}
