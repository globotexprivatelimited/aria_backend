import { enqueuePending, takePending, markPendingSent, reengagedRecently, recordReengagement } from "./pending";
import { alertOps } from "./alerts";
import { classifyMetaError } from "./metaErrors";
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

  const result = await sendWithRetry(phone, text, hotelId);
  await recordOutbound(hotelId, phone, text, "text", result);
  return result;
}

/**
 * Message a guest from an approved template - the only way to reach a guest whose 24 hour window is
 * closed. shownText is what the dashboard shows for it: the template as the guest reads it.
 */
export async function sendTemplateReply(phone: string, template: string, params: string[], hotelId: string, shownText: string, lang = "en"): Promise<SendResult> {
  log.info("outbound template", { phone, hotelId, template });
  const result = await sendTemplateWithRetry(phone, template, params, hotelId, lang);
  await recordOutbound(hotelId, phone, shownText, "template", result);
  return result;
}

/** Status only moves forward - Meta can deliver "read" before "delivered" - except that a failure always stands. */
const RANK: Record<string, number> = { accepted: 0, sent: 1, delivered: 2, read: 3, failed: 4 };

/** A status webhook from Meta: move the saved message to what actually happened to it. */
export async function recordDeliveryStatus(wamid: string, status: string, errors?: unknown, timestamp?: unknown): Promise<void> {
  if (!wamid || !(status in RANK)) return;
  try {
    const row = await prisma.message.findFirst({ where: { messageId: wamid }, select: { id: true, deliveryStatus: true, guestPhone: true, hotelId: true, body: true } });
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
    if (status === "failed") void onDeliveryFailed(row.hotelId, row.guestPhone, row.body ?? "", error ?? "failed");
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
    const result = await sendWithRetry(contact.whatsappNumber, text, hotelId);
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

/** WhatsApp's rate limit (130429) is answered with a pause and a retry, not a lost message. */
async function retrying<T extends { ok: boolean; error?: string | null }>(attempt: () => Promise<T>): Promise<T> {
  let r = await attempt();
  for (const pause of [1500, 4000]) {
    if (r.ok || classifyMetaError(r.error) !== "rate") break;
    await new Promise((res) => setTimeout(res, pause));
    r = await attempt();
  }
  return r;
}
async function sendWithRetry(...args: Parameters<typeof sendText>): Promise<Awaited<ReturnType<typeof sendText>>> {
  const r = await retrying(() => sendText(...args));
  if (!r.ok) void onSendRefused(String(args[0] ?? ""), String(args[1] ?? ""), args[2] != null ? String(args[2]) : "", r.error ?? "");
  return r;
}
async function sendTemplateWithRetry(...args: Parameters<typeof sendTemplate>): Promise<Awaited<ReturnType<typeof sendTemplate>>> {
  const r = await retrying(() => sendTemplate(...args));
  if (!r.ok) { const kind = classifyMetaError(r.error); if (kind === "token") void alertOps("meta_token_invalid", "WhatsApp refused a template send: " + (r.error ?? "")); else if (kind !== "config" && kind !== "window" && kind !== "undeliverable") void alertOps("meta_rejected", "template send refused: " + (r.error ?? ""), { template: String(args[1] ?? "") }); }
  return r;
}

/** A plain send refused synchronously: the same handling as a failure reported later by the status webhook. */
async function onSendRefused(guestPhone: string, text: string, hotelId: string, error: string): Promise<void> {
  const kind = classifyMetaError(error);
  if (kind === "config" || kind === "rate") return; // not configured is logged elsewhere; rate was already retried
  if (hotelId) await onDeliveryFailed(hotelId, guestPhone, text, error);
  else if (kind === "token") await alertOps("meta_token_invalid", "WhatsApp refused a send: " + error);
}

/**
 * A message that did not reach the guest. 131047 (window closed): hold it and send the re-engagement template.
 * 131026 (undeliverable): the front desk checks the number, once. A dead token or a template problem: a person is alerted.
 */
export async function onDeliveryFailed(hotelId: string, guestPhone: string, body: string, error: string): Promise<void> {
  try {
    const kind = classifyMetaError(error);
    if (kind === "window") {
      if (body && !/^\[re-engagement/.test(body)) await enqueuePending(hotelId, guestPhone, body, error);
      const template = (process.env.META_TEMPLATE_REENGAGE ?? "aria_hello").trim();
      if (template && !(await reengagedRecently(hotelId, guestPhone))) {
        await recordReengagement(hotelId, guestPhone, template);
        const r = await sendTemplateReply(guestPhone, template, [], hotelId, "[re-engagement: " + template + "]", (process.env.META_TEMPLATE_LANG ?? "en").trim() || "en");
        log.info("meta: window closed - message held, re-engagement template sent", { hotelId, phone: guestPhone, template, ok: r ? r.ok : null });
      } else if (!template) {
        await notifyGM(hotelId, "WhatsApp could not deliver a message to " + guestPhone + " - the guest has not written in 24 hours and no re-engagement template is configured. It is held and goes when they next write.");
      }
      return;
    }
    if (kind === "undeliverable") {
      const recent = await prisma.request.findFirst({ where: { hotelId, guestPhone, requestDetail: { startsWith: "WhatsApp number check" }, createdAt: { gt: new Date(Date.now() - 24 * 60 * 60 * 1000) } }, select: { id: true } });
      if (recent) return;
      const session = await prisma.session.findFirst({ where: { hotelId, guestPhone, state: { not: "closed" } }, orderBy: { createdAt: "desc" }, select: { id: true, roomNumber: true, claimedGuestName: true } });
      const who = (session?.claimedGuestName ?? "").trim() || "the guest";
      const detail = "WhatsApp number check - messages to " + guestPhone + " (" + who + ", room " + (session?.roomNumber ?? "unknown") + ") cannot be delivered: " + error + ". Please confirm the number with the guest and correct it at reception.";
      await prisma.request.create({ data: { hotelId, sessionId: session?.id ?? null, roomNumber: session?.roomNumber ?? null, guestPhone, intent: "concierge" as never, department: "front_desk" as never, requestDetail: detail, priority: "urgent" as never, status: "received" } });
      await notifyFrontDesk(hotelId, detail);
      log.warn("meta: undeliverable number flagged to the front desk", { hotelId, phone: guestPhone, error });
      return;
    }
    if (kind === "token") { await alertOps("meta_token_invalid", "WhatsApp refused a send: " + error); return; }
    if (kind === "config") return;
    await alertOps("meta_rejected", "WhatsApp did not deliver a message to " + guestPhone + ": " + error, { hotelId });
  } catch (e) {
    log.warn("meta: failure handling itself failed", { detail: e instanceof Error ? e.message : String(e) });
  }
}

/** The guest has written: anything held for them while the window was closed goes now, in order. */
export async function flushPending(hotelId: string, guestPhone: string): Promise<number> {
  let sent = 0;
  try {
    for (const m of await takePending(hotelId, guestPhone)) {
      const r = await sendReply(guestPhone, m.body, hotelId);
      if (r === null || r.ok) { await markPendingSent(m.id); sent++; } else break;
    }
    if (sent) log.info("meta: held messages delivered", { hotelId, phone: guestPhone, sent });
  } catch (e) {
    log.warn("meta: could not flush held messages", { detail: e instanceof Error ? e.message : String(e) });
  }
  return sent;
}
