import { Router } from "express";
import { handleInboundMessage, hotelForToken } from "./inbound";
import { log } from "../lib/logger";

export const aisensyRouter = Router();

/** Pull a value from the first path that exists. */
function pick(obj: any, paths: string[]): string {
  for (const path of paths) {
    let v: any = obj;
    for (const key of path.split(".")) {
      if (v == null) break;
      v = Array.isArray(v) ? v[0]?.[key] : v[key];
    }
    if (typeof v === "string" && v.trim()) return v.trim();
    if (typeof v === "number") return String(v);
  }
  return "";
}

/** AiSensy may verify the URL with a GET before saving it. */
aisensyRouter.get("/webhooks/aisensy/:hotelToken", async (req, res) => {
  const hotel = await hotelForToken(req.params.hotelToken);
  const challenge = req.query["hub.challenge"] ?? req.query.challenge;
  if (challenge) return res.status(200).send(String(challenge));
  return res.status(200).json({ ok: true, ready: !!hotel, endpoint: "aisensy webhook, POST only" });
});

aisensyRouter.post("/webhooks/aisensy/:hotelToken", async (req, res) => {
  res.status(200).json({ ok: true });
  try {
    const hotel = await hotelForToken(req.params.hotelToken);
    if (!hotel) { log.warn("aisensy: unknown or inactive hotel token"); return; }

    const b = req.body ?? {};

    // AiSensy has shipped a few payload shapes; accept the ones we know of.
    const guestPhone = pick(b, [
      "waNumber", "wa_id", "waId", "mobile", "from", "sender",
      "contacts.wa_id", "messages.from", "data.from", "payload.from", "payload.source",
    ]);
    const messageId = pick(b, [
      "messageId", "message_id", "id", "whatsappMessageId",
      "messages.id", "data.id", "payload.id",
    ]);
    const body = pick(b, [
      "text", "message", "body", "messageText",
      "text.body", "messages.text.body", "data.text", "payload.payload.text", "payload.text",
    ]);
    const type = pick(b, ["type", "messageType", "messages.type", "payload.type"]) || "text";

    if (!guestPhone || !messageId) {
      // Log the whole thing so the real field names are visible once, not guessed at forever.
      log.warn("aisensy: could not read the payload", { raw: JSON.stringify(b).slice(0, 1500) });
      return;
    }

    log.info("aisensy: inbound", { phone: guestPhone, type, chars: body.length });
    await handleInboundMessage(hotel, { messageId, guestPhone, type, body });
  } catch (err) {
    log.error("aisensy handler error", { detail: err instanceof Error ? err.message : String(err) });
  }
});
