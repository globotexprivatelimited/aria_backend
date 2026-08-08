import { Router } from "express";
import { WatiInbound } from "../lib/schemas";
import { handleInboundMessage, hotelForToken } from "./inbound";
import { log } from "../lib/logger";

export const watiRouter = Router();

watiRouter.post("/webhooks/wati/:hotelToken", async (req, res) => {
  res.status(200).json({ ok: true });
  try {
    const hotel = await hotelForToken(req.params.hotelToken);
    if (!hotel) { log.warn("wati: unknown or inactive hotel token"); return; }
    const parsed = WatiInbound.safeParse(req.body);
    if (!parsed.success) { log.warn("wati: invalid payload"); return; }
    const p = parsed.data;
    await handleInboundMessage(hotel, {
      messageId: p.whatsappMessageId ?? p.id ?? "",
      guestPhone: p.waId ?? "",
      type: p.type ?? "text",
      body: p.text ?? "",
    });
  } catch (err) {
    log.error("wati handler error", { detail: err instanceof Error ? err.message : String(err) });
  }
});
