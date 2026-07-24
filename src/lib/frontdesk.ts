import { prisma } from "../db";

export async function checkInGuest(hotelId: string, room: string, name: string, phone: string) {
  const guestPhone = phone.trim();
  const data = {
    state: "active" as const,
    roomNumber: room,
    claimedGuestName: name,
    roomVerified: true,
    verificationMethod: "front_desk_match" as const,
    checkInDate: new Date(),
    lastMessageAt: new Date(),
  };
  const existing = await prisma.session.findFirst({
    where: { hotelId, guestPhone, state: { not: "closed" } },
    orderBy: { createdAt: "desc" },
  });
  if (existing) return prisma.session.update({ where: { id: existing.id }, data });
  return prisma.session.create({ data: { hotelId, guestPhone, ...data } });
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
  return prisma.session.update({ where: { id: session.id }, data: { state: "closed" } });
}
