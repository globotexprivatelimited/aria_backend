import { prisma } from "../db";
import { scheduleStayTriggers, cancelTriggersForSession } from "../proactive";

export async function checkInGuest(hotelId: string, room: string, name: string, phone: string, checkOut?: Date | string | null) {
  const guestPhone = phone.trim();
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
  return session;
}

export async function checkOutGuest(hotelId: string, opts: { room?: string; phone?: string }) {
  const session = await prisma.session.findFirst({
    where: {
      hotelId,
      state: { not: "closed" },
      ...(opts.phone ? { guestPhone: opts.phone.trim() } : {}),
      ...(opts.room ? { roomNumber: opts.room } : {}),
    },
    orderBy: { createdAt: "desc" },
  });
  if (!session) return null;
  await cancelTriggersForSession(session.id, "checked out");
  return prisma.session.update({ where: { id: session.id }, data: { state: "closed" } });
}
