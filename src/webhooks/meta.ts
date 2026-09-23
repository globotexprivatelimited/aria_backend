import { recordDeliveryStatus } from "../lib/notify";
import { Router } from "express";
import { prisma } from "../db";
import { handleInboundMessage } from "./inbound";
import { log } from "../lib/logger";
import { verifyMetaSignature } from "../lib/security";

export const metaRouter = Router();

const VERIFY_TOKEN = process.env.META_VERIFY_TOKEN ?? "aria_verify";
// The Meta App Secret (App Dashboard > App settings > Basic). Every inbound POST must carry a matching
// X-Hub-Signature-256 or it is rejected - fail closed, so an unset secret rejects everything (D-001).
const APP_SECRET = process.env.META_APP_SECRET ?? "";
if (!APP_SECRET) log.warn("meta: META_APP_SECRET is not set - all inbound webhooks will be rejected until it is");

/** Meta calls this once when you save the callback URL. */
metaRouter.get("/webhooks/meta", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];
  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    log.info("meta: webhook verified");
    return res.status(200).send(String(challenge));
  }
  // never log the expected token (D-012)
  log.warn("meta: webhook verification failed", { gotMode: String(mode ?? "none"), tokenPresent: Boolean(token) });
  return res.sendStatus(403);
});

/** Guest messages arrive here - one URL for every hotel. */
metaRouter.post("/webhooks/meta", async (req, res) => {
  // D-001: reject anything not signed by Meta before we do any work
  const signature = req.header("x-hub-signature-256");
  const rawBody = (req as unknown as { rawBody?: Buffer }).rawBody;
  if (!verifyMetaSignature(rawBody, signature, APP_SECRET)) {
    log.warn("meta: rejected unsigned or badly signed webhook", { signaturePresent: Boolean(signature), secretConfigured: APP_SECRET.length > 0 });
    return res.sendStatus(401);
  }
  res.sendStatus(200);
  try {
    const entry = req.body?.entry?.[0];
    const change = entry?.changes?.[0]?.value;
    if (!change) return;

    // delivery receipts and read markers arrive here too; ignore them
    for (const st of change.statuses ?? []) {
      void recordDeliveryStatus(String((st as any)?.id ?? ""), String((st as any)?.status ?? ""), (st as any)?.errors, (st as any)?.timestamp);
      log.info("meta: status", { id: String(st.id ?? ""), status: String(st.status ?? ""), guestPhone: String(st.recipient_id ?? ""), errors: JSON.stringify(st.errors ?? []) });
    }
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
