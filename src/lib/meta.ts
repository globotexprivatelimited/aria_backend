import { log } from "./logger";
import { prisma } from "../db";

const VERSION = process.env.META_API_VERSION ?? "v21.0";
const TOKEN = process.env.META_ACCESS_TOKEN ?? "";
const DEFAULT_PHONE_ID = process.env.META_PHONE_NUMBER_ID ?? "";

export function isMetaConfigured(): boolean {
  return TOKEN.length > 0 && DEFAULT_PHONE_ID.length > 0;
}

/**
 * What Meta actually said about a send: its message id (wamid) when it accepted the message, its error when
 * it refused. Accepted is not delivered - delivery arrives later as a status webhook against the same id.
 */
export type SendResult = { ok: boolean; id: string | null; error: string | null };

/** Meta wants the number with country code and no plus. */
function normalise(phone: string): string {
  return phone.replace(/[^0-9]/g, "");
}

/** Each hotel sends from its own number; fall back to the platform default. */
async function phoneIdFor(hotelId?: string): Promise<string> {
  if (!hotelId) return DEFAULT_PHONE_ID;
  try {
    const r = await prisma.$queryRawUnsafe<any[]>(
      'select whatsapp_phone_id from "Hotel" where "hotelId" = $1', hotelId);
    return r[0]?.whatsapp_phone_id || DEFAULT_PHONE_ID;
  } catch { return DEFAULT_PHONE_ID; }
}

/** One send to the Cloud API, reading Meta's answer instead of assuming it. */
async function post(phone: string, payload: Record<string, unknown>, hotelId: string | undefined, what: string): Promise<SendResult> {
  if (!isMetaConfigured()) {
    log.warn("meta: not configured, " + what + " not sent", { phone });
    return { ok: false, id: null, error: "WhatsApp is not configured on this server" };
  }
  const phoneId = await phoneIdFor(hotelId);
  try {
    const res = await fetch("https://graph.facebook.com/" + VERSION + "/" + phoneId + "/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + TOKEN },
      body: JSON.stringify({ messaging_product: "whatsapp", to: normalise(phone), ...payload }),
    });
    const raw = await res.text();
    let j: any = null;
    try { j = JSON.parse(raw); } catch { /* not JSON */ }
    if (!res.ok) {
      const e = j?.error;
      const error = e ? [e.code, e.error_subcode].filter((x: unknown) => x !== undefined && x !== null).join("/") + " " + String(e.error_data?.details ?? e.message ?? "") : "HTTP " + res.status;
      log.error("meta: " + what + " refused", { phone, status: res.status, detail: raw.slice(0, 300) });
      return { ok: false, id: null, error: error.trim().slice(0, 300) };
    }
    const id = typeof j?.messages?.[0]?.id === "string" ? String(j.messages[0].id) : null;
    log.info("meta: " + what + " accepted", { phone, phoneId, id });
    return { ok: true, id, error: null };
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    log.error("meta: " + what + " threw", { phone, detail });
    return { ok: false, id: null, error: ("network: " + detail).slice(0, 300) };
  }
}

/** A plain text message. Meta only delivers it inside the 24 hour window the guest opens by writing. */
export function sendText(phone: string, text: string, hotelId?: string): Promise<SendResult> {
  return post(phone, { recipient_type: "individual", type: "text", text: { preview_url: false, body: text } }, hotelId, "message");
}

/** Template parameters may not be empty or contain new lines, tabs or runs of spaces. */
function cleanParam(p: string): string {
  return (String(p ?? "").replace(/\s+/g, " ").trim() || "-").slice(0, 60);
}

/** A business-initiated message from an approved template - delivered whether or not the window is open. */
export function sendTemplate(phone: string, template: string, params: string[] = [], hotelId?: string, lang = "en"): Promise<SendResult> {
  if (!template) return Promise.resolve({ ok: false, id: null, error: "no template name" });
  const body = params.length ? { components: [{ type: "body", parameters: params.map((p) => ({ type: "text", text: cleanParam(p) })) }] } : {};
  return post(phone, { type: "template", template: { name: template, language: { code: lang }, ...body } }, hotelId, "template " + template);
}

/** Kept for existing callers that only need yes or no. */
export async function sendWhatsAppMessage(phone: string, text: string, hotelId?: string): Promise<boolean> {
  return (await sendText(phone, text, hotelId)).ok;
}

/** Kept for existing callers that only need yes or no. */
export async function sendTemplateMessage(
  phone: string, template: string, params: string[] = [], hotelId?: string, lang = "en"
): Promise<boolean> {
  return (await sendTemplate(phone, template, params, hotelId, lang)).ok;
}

/**
 * Mark the guest's message read and show the WhatsApp typing indicator, so the guest sees Aria
 * "typing..." while the reply is composed. WhatsApp dismisses it when the reply is sent or after
 * 25 seconds, whichever comes first. Best-effort: a failure here must never block the actual reply.
 */
export async function sendTypingIndicator(messageId: string, hotelId?: string): Promise<void> {
  if (!isMetaConfigured() || !messageId) return;
  const phoneId = await phoneIdFor(hotelId);
  try {
    const res = await fetch("https://graph.facebook.com/" + VERSION + "/" + phoneId + "/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + TOKEN },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        status: "read",
        message_id: messageId,
        typing_indicator: { type: "text" },
      }),
    });
    if (!res.ok) {
      const body = await res.text();
      log.warn("meta: typing indicator not shown", { status: res.status, detail: body.slice(0, 200) });
    }
  } catch (err) {
    log.warn("meta: typing indicator threw", { detail: err instanceof Error ? err.message : String(err) });
  }
}
