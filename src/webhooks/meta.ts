import { Router } from "express";
import { prisma } from "../db";
import { handleInboundMessage } from "./inbound";
import { log } from "../lib/logger";

export const metaRouter = Router();

const VERIFY_TOKEN = process.env.META_VERIFY_TOKEN ?? "aria_verify";

/** Meta calls this once when you save the callback URL. */
metaRouter.get("/webhooks/meta", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];
  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    log.info("meta: webhook verified");
    return res.status(200).send(String(challenge));
  }
  log.warn("meta: webhook verification failed", {
    gotMode: String(mode ?? "none"),
    gotToken: String(token ?? "none"),
    expected: VERIFY_TOKEN,
    match: token === VERIFY_TOKEN,
  });
  return res.sendStatus(403);
});

/** Guest messages arrive here - one URL for every hotel. */
metaRouter.post("/webhooks/meta", async (req, res) => {
  res.sendStatus(200);
  try {
    const entry = req.body?.entry?.[0];
    const change = entry?.changes?.[0]?.value;
    if (!change) return;

    // delivery receipts and read markers arrive here too; ignore them
    if (!change.messages?.length) return;

    const phoneId = String(change.metadata?.phone_number_id ?? "");
    const hotelRows = await prisma.$queryRawUnsafe<any[]>(
      `select * from "Hotel" where whatsapp_phone_id = $1 and "isActive" limit 1`, phoneId);
    const hotel = hotelRows[0];
    if (!hotel) {
      log.warn("meta: no hotel for this number", { phoneId });
      return;
    }

    for (const m of change.messages) {
      const type = String(m.type ?? "text");
      const body =
        type === "text" ? (m.text?.body ?? "")
        : type === "button" ? (m.button?.text ?? "")
        : type === "interactive" ? (m.interactive?.button_reply?.title ?? m.interactive?.list_reply?.title ?? "")
        : "";

      await handleInboundMessage(hotel, {
        messageId: String(m.id ?? ""),
        guestPhone: String(m.from ?? ""),
        type,
        body,
      });
    }
  } catch (err) {
    log.error("meta handler error", { detail: err instanceof Error ? err.message : String(err) });
  }
});
