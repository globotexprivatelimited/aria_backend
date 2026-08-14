import { log } from "./logger";

const BASE = (process.env.AISENSY_API_URL ?? "https://backend.aisensy.com").replace(/\/+$/, "");
const API_KEY = process.env.AISENSY_API_KEY ?? "";
/** Campaign name for staff and business-initiated messages (needs an approved template). */
const CAMPAIGN = process.env.AISENSY_CAMPAIGN ?? "";

export function isAiSensyConfigured(): boolean {
  return API_KEY.length > 0;
}

/** AiSensy expects the number with country code, no plus. */
function normalise(phone: string): string {
  return phone.replace(/[^0-9]/g, "");
}

/**
 * Send a free-form message. WhatsApp only allows this within 24 hours of the
 * guest writing in - outside that window it needs a template campaign instead.
 */
export async function sendWhatsAppMessage(phone: string, text: string): Promise<boolean> {
  if (!isAiSensyConfigured()) {
    log.warn("aisensy: not configured, message not sent", { phone });
    return false;
  }
  const to = normalise(phone);
  try {
    const res = await fetch(BASE + "/direct-apis/t1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-AiSensy-Partner-API-Key": API_KEY },
      body: JSON.stringify({
        to,
        type: "text",
        recipient_type: "individual",
        text: { body: text },
      }),
    });
    if (!res.ok) {
      const body = await res.text();
      log.error("aisensy: send failed", { phone, status: res.status, detail: body.slice(0, 250) });
      return false;
    }
    log.info("aisensy: message sent", { phone });
    return true;
  } catch (err) {
    log.error("aisensy: send threw", { phone, detail: err instanceof Error ? err.message : String(err) });
    return false;
  }
}

/**
 * Business-initiated message via an approved template - used for staff alerts,
 * where there is no open 24 hour window to reply into.
 */
export async function sendTemplateMessage(phone: string, params: string[], campaign?: string): Promise<boolean> {
  const name = campaign ?? CAMPAIGN;
  if (!isAiSensyConfigured() || !name) {
    log.warn("aisensy: template not sent - missing key or campaign", { phone });
    return false;
  }
  try {
    const res = await fetch(BASE + "/campaign/t1/api/v2", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        apiKey: API_KEY,
        campaignName: name,
        destination: normalise(phone),
        userName: "Aria",
        templateParams: params,
      }),
    });
    if (!res.ok) {
      const body = await res.text();
      log.error("aisensy: template failed", { phone, status: res.status, detail: body.slice(0, 250) });
      return false;
    }
    log.info("aisensy: template sent", { phone, campaign: name });
    return true;
  } catch (err) {
    log.error("aisensy: template threw", { phone, detail: err instanceof Error ? err.message : String(err) });
    return false;
  }
}
