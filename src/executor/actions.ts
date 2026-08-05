import { prisma } from "../db";
import { log } from "../lib/logger";
import { sendReply, notifyGM } from "../lib/notify";

export function shortRef(id: string): string {
  return id.slice(0, 8);
}

async function findRequest(hotelId: string, ref: string) {
  const rows = await prisma.request.findMany({
    where: { hotelId, status: { in: ["received", "in_progress"] } },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  return rows.find((r) => r.id.startsWith(ref.toLowerCase())) ?? null;
}

// ---- Type A: ACCEPT / DECLINE / ALTERNATIVE ----

export async function acceptRequest(hotelId: string, ref: string, staffName: string) {
  const req = await findRequest(hotelId, ref);
  if (!req) return { ok: false, message: "No open request found with reference " + ref + "." };

  await prisma.request.update({
    where: { id: req.id },
    data: { status: "in_progress", claimedBy: staffName },
  });

  await sendReply(req.guestPhone, "Good news - " + (req.requestDetail ?? "your request") + " is confirmed. We are arranging it now.", hotelId);
  log.info("action: accepted", { requestId: req.id, staffName });
  return { ok: true, message: "Accepted " + ref + " and told the guest." };
}

export async function declineRequest(hotelId: string, ref: string, staffName: string, reason?: string) {
  const req = await findRequest(hotelId, ref);
  if (!req) return { ok: false, message: "No open request found with reference " + ref + "." };

  await prisma.request.update({
    where: { id: req.id },
    data: { status: "resolved", claimedBy: staffName, resolvedAt: new Date() },
  });

  const because = reason ? " (" + reason + ")" : "";
  await sendReply(req.guestPhone, "I am sorry - we are not able to arrange that right now" + because + ". Our front desk would be glad to help with an alternative.", hotelId);
  log.info("action: declined", { requestId: req.id, staffName });
  return { ok: true, message: "Declined " + ref + " and told the guest." };
}

export async function proposeAlternative(hotelId: string, ref: string, staffName: string, alternative: string) {
  const req = await findRequest(hotelId, ref);
  if (!req) return { ok: false, message: "No open request found with reference " + ref + "." };

  await prisma.request.update({
    where: { id: req.id },
    data: { status: "in_progress", claimedBy: staffName },
  });

  await sendReply(req.guestPhone, "We cannot do exactly that, but we can offer: " + alternative + ". Would that work for you?", hotelId);
  log.info("action: alternative proposed", { requestId: req.id, staffName });
  return { ok: true, message: "Offered an alternative for " + ref + "." };
}

// ---- Type B: CLAIM / DONE / PROBLEM ----

export async function claimRequest(hotelId: string, ref: string, staffName: string) {
  const req = await findRequest(hotelId, ref);
  if (!req) return { ok: false, message: "No open request found with reference " + ref + "." };

  await prisma.request.update({
    where: { id: req.id },
    data: { status: "in_progress", claimedBy: staffName },
  });

  log.info("action: claimed", { requestId: req.id, staffName });
  return { ok: true, message: "You have claimed " + ref + ". Tap DONE when it is delivered." };
}

export async function completeRequest(hotelId: string, ref: string, staffName: string) {
  const req = await findRequest(hotelId, ref);
  if (!req) return { ok: false, message: "No open request found with reference " + ref + "." };

  await prisma.request.update({
    where: { id: req.id },
    data: { status: "resolved", claimedBy: staffName, resolvedAt: new Date() },
  });

  await sendReply(req.guestPhone, (req.requestDetail ?? "Your request") + " has been taken care of. Enjoy, and let me know if you need anything else.", hotelId);
  log.info("action: completed", { requestId: req.id, staffName });
  return { ok: true, message: "Marked " + ref + " done and told the guest." };
}

export async function problemRequest(hotelId: string, ref: string, staffName: string, reason?: string) {
  const req = await findRequest(hotelId, ref);
  if (!req) return { ok: false, message: "No open request found with reference " + ref + "." };

  await prisma.request.update({
    where: { id: req.id },
    data: { status: "in_progress", claimedBy: staffName },
  });

  const because = reason ? ": " + reason : "";
  await notifyGM(hotelId, "PROBLEM on request " + shortRef(req.id) + " (room " + (req.roomNumber ?? "?") + ")" + because + ". Needs a hand.");
  log.info("action: problem escalated", { requestId: req.id, staffName });
  return { ok: true, message: "Flagged a problem on " + ref + " to the GM." };
}
