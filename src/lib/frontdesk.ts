import { prisma } from "../db";
import { scheduleStayTriggers, cancelTriggersForSession } from "../proactive";
import { sendTemplateMessage } from "./meta";

const WELCOME_TEMPLATE = process.env.WELCOME_TEMPLATE ?? "guest_welcome";

/** Canonical guest phone: "+" then digits with country code, matching webhooks/inbound.ts. */
export function canonicalPhone(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  return "+" + (digits.length === 10 ? "91" + digits : digits);
}

/** The UTC day a check-in falls on - the same day Prisma stores in the date-only checkInDate column. */
function dayBounds(at: Date): { start: Date; end: Date } {
  const start = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()));
  return { start, end: new Date(start.getTime() + 86400000) };
}

export async function checkInGuest(hotelId: string, room: string, name: string, phone: string, checkOut?: Date | string | null) {
  const guestPhone = canonicalPhone(phone);
  const checkInAt = new Date();
  const data = {
    state: "active" as const,
    roomNumber: room,
    claimedGuestName: name,
    roomVerified: true,
    verificationMethod: "front_desk_match" as const,
    checkInDate: checkInAt,
    checkOutDate: checkOut ? new Date(checkOut) : undefined,
    lastMessageAt: new Date(),
  };

  // Session is unique on (hotelId, guestPhone, checkInDate), so today's row is the only one that can
  // carry today's check-in. A guest who checked out this morning and is checking back in now already
  // has that row - updating any other row to today's date would collide with it and lose the check-in.
  const { start, end } = dayBounds(checkInAt);
  const today = await prisma.session.findFirst({
    where: { hotelId, guestPhone, checkInDate: { gte: start, lt: end } },
    orderBy: { updatedAt: "desc" },
  });

  let session = today ? await prisma.session.update({ where: { id: today.id }, data }) : null;
  if (!session) {
    const live = await prisma.session.findFirst({
      where: { hotelId, guestPhone, state: { not: "closed" } },
      orderBy: { createdAt: "desc" },
    });
    if (live) session = await prisma.session.update({ where: { id: live.id }, data });
  }
  if (!session) {
    try {
      session = await prisma.session.create({ data: { hotelId, guestPhone, ...data } });
    } catch (e) {
      if ((e as { code?: string })?.code !== "P2002") throw e;
      const clash = await prisma.session.findFirst({ where: { hotelId, guestPhone }, orderBy: [{ checkInDate: { sort: "desc", nulls: "last" } }, { updatedAt: "desc" }] });
      if (!clash) throw e;
      session = await prisma.session.update({ where: { id: clash.id }, data });
    }
  }
  if (!session) throw new Error("check-in: no session");

  // Any other open session for this guest - a prospect row created when they messaged before the desk
  // got to them - would be the one the webhook finds, and they would be told they are not registered.
  const shadowed = await prisma.session.updateMany({
    where: { hotelId, guestPhone, id: { not: session.id }, state: { not: "closed" } },
    data: { state: "closed" },
  });
  if (shadowed.count) console.log("check-in: closed " + shadowed.count + " stale session(s) for " + guestPhone);

  await scheduleStayTriggers(hotelId, session.id, guestPhone, session.checkOutDate);

  // A welcome message that cannot be delivered must not cost us the check-in itself.
  try {
    const hotelRow = await prisma.hotel.findUnique({ where: { hotelId }, select: { name: true } });
    const firstName = name.trim().split(/\s+/)[0] || "Guest";
    await sendTemplateMessage(guestPhone, WELCOME_TEMPLATE, [hotelRow?.name ?? "our hotel", firstName], hotelId);
  } catch (e) {
    console.log("check-in: welcome template not sent:", e instanceof Error ? e.message : String(e));
  }
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
