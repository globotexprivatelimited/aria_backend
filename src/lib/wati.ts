import { log } from "./logger";

const BASE = (process.env.WATI_API_URL ?? "").replace(/\/+$/, "");
const TOKEN = process.env.WATI_ACCESS_TOKEN ?? "";

export function isWatiConfigured(): boolean {
  return BASE.length > 0 && TOKEN.length > 0;
}

/** Wati wants the number without a leading +. */
function normalise(phone: string): string {
  return phone.replace(/[^0-9]/g, "");
}

export async function sendWhatsAppMessage(phone: string, text: string): Promise<boolean> {
  if (!isWatiConfigured()) {
    log.warn("wati: not configured, message not sent", { phone });
    return false;
  }

  const to = normalise(phone);
  const url = BASE + "/api/v1/sendSessionMessage/" + to + "?messageText=" + encodeURIComponent(text);

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: TOKEN.startsWith("Bearer ") ? TOKEN : "Bearer " + TOKEN,
        "Content-Type": "application/json-patch+json",
      },
    });

    if (!res.ok) {
      const body = await res.text();
      log.error("wati: send failed", { phone, status: res.status, detail: body.slice(0, 200) });
      return false;
    }

    log.info("wati: message sent", { phone });
    return true;
  } catch (err) {
    log.error("wati: send threw", { phone, detail: err instanceof Error ? err.message : String(err) });
    return false;
  }
}
