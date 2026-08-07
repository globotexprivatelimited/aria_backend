import { Router } from "express";
import { prisma } from "../db";
import { enqueue } from "../lib/queue";
import { WatiInbound } from "../lib/schemas";
import { runSafetyChecks } from "../safety";
import { runSession } from "../session";
import { ensureConsentOnFirstContact, isWithdrawalKeyword, CONSENT_NOTICE } from "../privacy/consent";
import { eraseGuestData } from "../privacy/erasure";
import { loadDeptModes } from "../deptconfig/service";
import { sendReply } from "../lib/notify";
import { log } from "../lib/logger";
import { understand } from "../brain";
import { executeRequests } from "../executor";
import { isProactiveOptOut, optOutOfProactive } from "../proactive";

export const watiRouter = Router();

watiRouter.post("/webhooks/wati/:hotelToken", async (req, res) => {
  res.status(200).json({ ok: true });

  try {
    const hotel = await prisma.hotel.findUnique({
      where: { webhookToken: req.params.hotelToken },
    });
    if (!hotel || !hotel.isActive) {
      log.warn("wati: unknown or inactive hotel token");
      return;
    }

    const parsed = WatiInbound.safeParse(req.body);
    if (!parsed.success) {
      log.warn("wati: invalid payload");
      return;
    }
    const p = parsed.data;

    const messageId = p.whatsappMessageId ?? p.id;
    const guestPhone = p.waId;
    if (!messageId || !guestPhone) {
      log.warn("wati: missing messageId or waId");
      return;
    }

    const dup = await prisma.processedMessage.findUnique({ where: { messageId } });
    if (dup) {
      log.info("duplicate ignored", { messageId });
      return;
    }
    await prisma.processedMessage.create({
      data: { messageId, hotelId: hotel.hotelId },
    });

    const type = (p.type ?? "text").toLowerCase();
    const body = (p.text ?? "").trim();

    if (type === "text" && body.length < 1) {
      log.info("blank message ignored");
      return;
    }

    await prisma.message.create({
      data: {
        hotelId: hotel.hotelId,
        guestPhone,
        waId: guestPhone,
        messageId,
        direction: "inbound",
        messageType: type,
        body: body || null,
      },
    });

    enqueue(hotel.hotelId + ":" + guestPhone, async () => {
      if (isWithdrawalKeyword(body)) {
        const er = await eraseGuestData(hotel.hotelId, guestPhone, "guest");
        await sendReply(guestPhone, "Your data has been erased and you will not receive further messages. Thank you for staying with us.", hotel.hotelId);
        log.info("erasure on request", { phone: guestPhone, records: er.recordsWiped });
        return;
      }

      const consentState = await ensureConsentOnFirstContact(hotel.hotelId, guestPhone);
      if (!consentState.existing) {
        await sendReply(guestPhone, CONSENT_NOTICE, hotel.hotelId);
      }

      const safety = await runSafetyChecks(body, hotel, guestPhone);
      if (safety.handled) {
        log.info("safety handled - AI skipped", { phone: guestPhone, reason: safety.reason });
        return;
      }
      const { proceed, session } = await runSession(hotel, guestPhone, body);
      if (!proceed) {
        log.info("session handled - AI skipped", { phone: guestPhone, state: session.state });
        return;
      }

      if (isProactiveOptOut(body)) {
        await optOutOfProactive(session.id);
        await sendReply(guestPhone, "Of course - I will not send you any unprompted messages. I am still here whenever you need something.", hotel.hotelId);
        log.info("proactive: guest opted out", { phone: guestPhone });
        return;
      }

      const deptModes = Object.fromEntries(await loadDeptModes(hotel.hotelId));
      const { output, usedFallback } = await understand(body, { ...hotel, deptModes }, session);

      await sendReply(guestPhone, output.reply, hotel.hotelId);

      const exec = await executeRequests(output, hotel, session, guestPhone, messageId);

      log.info("brain result", {
        phone: guestPhone,
        room: session.roomNumber ?? "-",
        requests: output.requests.map((r) => r.intent + ": " + r.detail).join(" | ") || "none",
        sentiment: output.sentiment,
        needsHuman: output.needsHuman,
        usedFallback,
        created: exec.created,
        escalated: exec.escalated,
      });
    });
  } catch (err) {
    log.error("wati handler error", { detail: err instanceof Error ? err.message : String(err) });
  }
});
