import { log } from "./logger";
import { sendWhatsAppMessage, isMetaConfigured } from "./meta";
import { prisma } from "../db";

/** Message a guest. Falls back to logging when WhatsApp is not configured. */
export async function sendReply(phone: string, text: string, hotelId: string): Promise<void> {
  log.info("outbound reply", { phone, hotelId, body: text });
  // the same text twice in a row is never what a guest wants, whatever upstream retried or doubled
  try {
    const twin = await prisma.message.findFirst({ where: { hotelId, guestPhone: phone, direction: "outbound", body: text, createdAt: { gt: new Date(Date.now() - 120000) } }, select: { id: true } });
    if (twin) { log.warn("outbound reply suppressed - identical text sent to this guest moments ago", { phone, hotelId }); return; }
  } catch { /* the guard must never block a reply */ }

  if (isMetaConfigured()) {
    await sendWhatsAppMessage(phone, text, hotelId);
  }

  try {
    await prisma.message.create({
      data: {
        hotelId,
        guestPhone: phone,
        waId: phone,
        messageId: "out-" + Date.now() + "-" + Math.random().toString(36).slice(2, 8),
        direction: "outbound",
        messageType: "text",
        body: text,
      },
    });
  } catch (err) {
    log.error("failed to log outbound message", { detail: err instanceof Error ? err.message : String(err) });
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
    await sendWhatsAppMessage(contact.whatsappNumber, text, hotelId);
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
