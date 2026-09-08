import { prisma } from "../db";
import { scheduleStayTriggers, cancelTriggersForSession } from "../proactive";
import { sendTemplateMessage } from "./meta";

const WELCOME_TEMPLATE = process.env.WELCOME_TEMPLATE ?? "guest_welcome";

/** Canonical guest phone: digits only with country code, matching the wa_id Meta sends. */
export function canonicalPhone(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  return digits.length === 10 ? "91" + digits : digits;
}

export async function checkInGuest(hotelId: string, room: string, name: string, phone: string, checkOut?: Date | string | null) {
  const guestPhone = canonicalPhone(phone);
  const data = {
    state: "active" as const,
    roomNumber: room,
    claimedGuestName: name,
    roomVerified: true,
    verificationMethod: "front_desk_match" as const,
    checkInDate: new Date(),
    checkOutDate: checkOut ? new Date(checkOut) : undefined,
    lastMessageAt: new Date(),
  };
  const existing = await prisma.session.findFirst({
    where: { hotelId, guestPhone, state: { not: "closed" } },
    orderBy: { createdAt: "desc" },
  });
  const session = existing
    ? await prisma.session.update({ where: { id: existing.id }, data })
    : await prisma.session.create({ data: { hotelId, guestPhone, ...data } });

  await scheduleStayTriggers(hotelId, session.id, guestPhone, session.checkOutDate);

  const hotelRow = await prisma.hotel.findUnique({ where: { hotelId }, select: { name: true } });
  const firstName = name.trim().split(/\s+/)[0] || "Guest";
  await sendTemplateMessage(guestPhone, WELCOME_TEMPLATE, [hotelRow?.name ?? "our hotel", firstName], hotelId);
  return session;
}

export async function checkOutGuest(hotelId: string, opts: { room?: string; phone?: string }) {
  const session = await prisma.session.findFirst({
    where: {
      hotelId,
      state: { not: "closed" },
      ...(opts.phone ? { guestPhone: canonicalPhone(opts.phone) } : {}),
      ...(opts.room ? { roomNumber: opts.room } : {}),
    },
    orderBy: { createdAt: "desc" },
  });
  if (!session) return null;
  await cancelTriggersForSession(session.id, "checked out");
  return prisma.session.update({ where: { id: session.id }, data: { state: "closed" } });
}
