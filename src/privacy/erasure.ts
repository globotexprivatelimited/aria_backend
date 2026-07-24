import { prisma } from "../db";

export async function eraseGuestData(hotelId: string, guestPhone: string, requestedBy?: string) {
  const record = await prisma.erasureRequest.create({
    data: { hotelId, guestPhone, requestedBy: requestedBy ?? "guest" },
  });

  let wiped = 0;

  const msgs = await prisma.message.deleteMany({ where: { hotelId, guestPhone } });
  wiped += msgs.count;

  const sessions = await prisma.session.updateMany({
    where: { hotelId, guestPhone },
    data: { claimedGuestName: null, state: "closed" },
  });
  wiped += sessions.count;

  const reqs = await prisma.request.updateMany({
    where: { hotelId, guestPhone },
    data: { requestDetail: null, ariaInterpretation: null },
  });
  wiped += reqs.count;

  await prisma.guestConsent.updateMany({
    where: { hotelId, guestPhone },
    data: { status: "withdrawn", withdrawnAt: new Date() },
  });

  await prisma.erasureRequest.update({
    where: { id: record.id },
    data: { completedAt: new Date(), recordsWiped: wiped },
  });

  return { erasureId: record.id, recordsWiped: wiped };
}

export async function exportGuestData(hotelId: string, guestPhone: string) {
  const [consent, sessions, messages, requests] = await Promise.all([
    prisma.guestConsent.findUnique({ where: { hotelId_guestPhone: { hotelId, guestPhone } } }),
    prisma.session.findMany({ where: { hotelId, guestPhone } }),
    prisma.message.findMany({ where: { hotelId, guestPhone }, orderBy: { createdAt: "asc" } }),
    prisma.request.findMany({ where: { hotelId, guestPhone }, orderBy: { createdAt: "asc" } }),
  ]);
  return { guestPhone, consent, sessions, messages, requests };
}
