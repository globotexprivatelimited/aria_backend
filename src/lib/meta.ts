import { log } from "./logger";
import { prisma } from "../db";

const VERSION = process.env.META_API_VERSION ?? "v21.0";
const TOKEN = process.env.META_ACCESS_TOKEN ?? "";
const DEFAULT_PHONE_ID = process.env.META_PHONE_NUMBER_ID ?? "";

export function isMetaConfigured(): boolean {
  return TOKEN.length > 0 && DEFAULT_PHONE_ID.length > 0;
}

/** Meta wants the number with country code and no plus. */
function normalise(phone: string): string {
  return phone.replace(/[^0-9]/g, "");
}

/** Each hotel sends from its own number; fall back to the platform default. */
async function phoneIdFor(hotelId?: string): Promise<string> {
  if (!hotelId) return DEFAULT_PHONE_ID;
  try {
    const r = await prisma.$queryRawUnsafe<any[]>(
      `select whatsapp_phone_id from "Hotel" where "hotelId" = $1`, hotelId);
    return r[0]?.whatsapp_phone_id || DEFAULT_PHONE_ID;
  } catch { return DEFAULT_PHONE_ID; }
}

/** A plain reply inside the 24 hour window. */
export async function sendWhatsAppMessage(phone: string, text: string, hotelId?: string): Promise<boolean> {
  if (!isMetaConfigured()) {
    log.warn("meta: not configured, message not sent", { phone });
    return false;
  }
  const phoneId = await phoneIdFor(hotelId);
  try {
    const res = await fetch("https://graph.facebook.com/" + VERSION + "/" + phoneId + "/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + TOKEN },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: normalise(phone),
        type: "text",
        text: { preview_url: false, body: text },
      }),
    });
    if (!res.ok) {
      const body = await res.text();
      log.error("meta: send failed", { phone, status: res.status, detail: body.slice(0, 300) });
      return false;
    }
    log.info("meta: message sent", { phone, phoneId });
    return true;
  } catch (err) {
    log.error("meta: send threw", { phone, detail: err instanceof Error ? err.message : String(err) });
    return false;
  }
}

/** Business-initiated message - needs an approved template. */
export async function sendTemplateMessage(
  phone: string, template: string, params: string[] = [], hotelId?: string, lang = "en"
): Promise<boolean> {
  if (!isMetaConfigured() || !template) {
    log.warn("meta: template not sent", { phone, template });
    return false;
  }
  const phoneId = await phoneIdFor(hotelId);
  try {
    const res = await fetch("https://graph.facebook.com/" + VERSION + "/" + phoneId + "/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + TOKEN },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: normalise(phone),
        type: "template",
        template: {
          name: template,
          language: { code: lang },
          components: params.length
            ? [{ type: "body", parameters: params.map((p) => ({ type: "text", text: p })) }]
            : undefined,
        },
      }),
    });
    if (!res.ok) {
      const body = await res.text();
      log.error("meta: template failed", { phone, template, status: res.status, detail: body.slice(0, 300) });
      return false;
    }
    log.info("meta: template sent", { phone, template });
    return true;
  } catch (err) {
    log.error("meta: template threw", { phone, detail: err instanceof Error ? err.message : String(err) });
    return false;
  }
}
