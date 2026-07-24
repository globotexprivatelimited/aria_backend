import { prisma } from "../db";
import { runSession } from "../session";

async function main() {
  const hotel = await prisma.hotel.findUnique({ where: { webhookToken: "demo-token-123" } });
  console.log("hotel:", hotel ? hotel.hotelId + " / active=" + hotel.isActive : "NOT FOUND");
  if (!hotel) return;

  const phone = "+919999000002";
  for (const text of ["Hi", "412", "Mahasin Khan", "Can I get 2 towels"]) {
    try {
      const r = await runSession(hotel, phone, text);
      console.log('msg "' + text + '" -> proceed=' + r.proceed + " state=" + r.session.state + " room=" + (r.session.roomNumber ?? "-"));
    } catch (e) {
      console.error('msg "' + text + '" THREW:', e);
    }
  }

  const rows = await prisma.session.findMany({ where: { guestPhone: phone }, orderBy: { createdAt: "desc" } });
  console.log("sessions now:", rows.map((x) => ({ state: x.state, room: x.roomNumber, name: x.claimedGuestName })));
}

main().finally(() => prisma.$disconnect());
