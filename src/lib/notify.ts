import { log } from "./logger";
import { sendText, sendTemplate, isMetaConfigured, type SendResult } from "./meta";
import { prisma } from "../db";

/**
 * Every message to a guest is saved with what Meta actually said about it: the conversation in the
 * dashboard shows accepted, sent, delivered, read - or failed, with Meta's reason - never an
 * assumption. Accepted is recorded at send time; the rest arrives by status webhook (recordDeliveryStatus).
 */
async function recordOutbound(hotelId: string, phone: string, body: string, type: string, result: SendResult): Promise<void> {
  try {
    await prisma.message.create({
      data: {
        hotelId,
        guestPhone: phone,
        waId: phone,
        messageId: result.id ?? "out-" + Date.now() + "-" + Math.random().toString(36).slice(2, 8),
        direction: "outbound",
        messageType: type,
        body,
        deliveryStatus: result.ok ? "accepted" : isMetaConfigured() ? "rejected" : "not_sent",
        deliveryError: result.error,
        statusAt: new Date(),
      },
    });
  } catch (err) {
    log.error("failed to log outbound message", { detail: err instanceof Error ? err.message : String(err) });
  }
}

/** Message a guest as plain text (inside their 24 hour window). Returns what Meta said, or null if suppressed as a repeat. */
export async function sendReply(phone: string, text: string, hotelId: string): Promise<SendResult | null> {
  log.info("outbound reply", { phone, hotelId, body: text });
  // the same text twice within seconds is a double-fire, never a reply - a guest who repeats a question ten seconds later still gets an answer
  try {
    const twin = await prisma.message.findFirst({ where: { hotelId, guestPhone: phone, direction: "outbound", body: text, createdAt: { gt: new Date(Date.now() - 10000) } }, select: { id: true } });
    if (twin) { log.warn("outbound reply suppressed - identical text sent to this guest moments ago", { phone, hotelId }); return null; }
  } catch { /* the guard must never block a reply */ }

  const result = await sendText(phone, text, hotelId);
  await recordOutbound(hotelId, phone, text, "text", result);
  return result;
}

/**
 * Message a guest from an approved template - the only way to reach a guest whose 24 hour window is
 * closed. shownText is what the dashboard shows for it: the template as the guest reads it.
 */
export async function sendTemplateReply(phone: string, template: string, params: string[], hotelId: string, shownText: string, lang = "en"): Promise<SendResult> {
  log.info("outbound template", { phone, hotelId, template });
  const result = await sendTemplate(phone, template, params, hotelId, lang);
  await recordOutbound(hotelId, phone, shownText, "template", result);
  return result;
}

/** Status only moves forward - Meta can deliver "read" before "delivered" - except that a failure always stands. */
const RANK: Record<string, number> = { accepted: 0, sent: 1, delivered: 2, read: 3, failed: 4 };

/** A status webhook from Meta: move the saved message to what actually happened to it. */
export async function recordDeliveryStatus(wamid: string, status: string, errors?: unknown, timestamp?: unknown): Promise<void> {
  if (!wamid || !(status in RANK)) return;
  try {
    const row = await prisma.message.findFirst({ where: { messageId: wamid }, select: { id: true, deliveryStatus: true, guestPhone: true } });
    if (!row) return; // staff notifications are not part of any guest conversation
    const current = row.deliveryStatus && row.deliveryStatus in RANK ? RANK[row.deliveryStatus] : -1;
    if (current >= RANK[status]) return;
    const first = Array.isArray(errors) && errors.length ? (errors[0] as Record<string, any>) : null;
    const error = first ? (String(first.code ?? "") + " " + String(first.error_data?.details ?? first.title ?? first.message ?? "")).trim().slice(0, 300) : null;
    const secs = Number(timestamp);
    await prisma.message.update({
      where: { id: row.id },
      data: { deliveryStatus: status, statusAt: secs > 0 ? new Date(secs * 1000) : new Date(), ...(status === "failed" ? { deliveryError: error ?? "failed" } : {}) },
    });
    if (status === "failed") log.warn("meta: message to guest NOT delivered", { wamid, phone: row.guestPhone, error });
  } catch (err) {
    log.warn("meta: could not record delivery status", { wamid, status, detail: err instanceof Error ? err.message : String(err) });
  }
}

/** Reach a department through its registered staff contact. */
async function messageDepartment(hotelId: string, dept: string, text: string): Promise<void> {
  const contact = await prisma.staffContact.findFirst({
    where: { hotelId, department: dept as never, isActive: true },
  });

  if (!contact || !contact.whatsappNumber) {
    log.warn("no staff contact for department", { hotelId, dept });
    return;
  }

  if (isMetaConfigured()) {
    const result = await sendText(contact.whatsappNumber, text, hotelId);
    if (!result.ok) log.warn("department not reached on WhatsApp", { hotelId, dept, error: result.error });
  }
}

export async function notifyGM(hotelId: string, text: string): Promise<void> {
  log.warn("notify GM", { hotelId, detail: text });
  await messageDepartment(hotelId, "gm", text);
}

export async function notifyFrontDesk(hotelId: string, text: string): Promise<void> {
  log.warn("notify front desk", { hotelId, detail: text });
  await messageDepartment(hotelId, "front_desk", text);
}

export async function notifyDepartment(hotelId: string, dept: string, text: string): Promise<void> {
  log.info("notify department", { hotelId, dept, detail: text });
  await messageDepartment(hotelId, dept, text);
}
