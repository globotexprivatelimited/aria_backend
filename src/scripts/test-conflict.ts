import { prisma } from "../db";
import { runSession } from "../session";

async function main() {
  const hotel = await prisma.hotel.findUnique({ where: { hotelId: "demo" } });
  if (!hotel) { console.log("no demo hotel"); return; }

  const phone = "+919555" + Math.floor(Math.random() * 900000 + 100000);
  console.log("Imposter phone:", phone, "\n");

  for (const text of ["Hi", "305", "Imposter Guy"]) {
    const r = await runSession(hotel, phone, text);
    console.log('  "' + text + '" -> state=' + r.session.state + " room=" + (r.session.roomNumber ?? "-") + " proceed=" + r.proceed);
  }

  const s = await prisma.session.findFirst({ where: { hotelId: "demo", guestPhone: phone }, orderBy: { createdAt: "desc" } });
  console.log("\nFinal:", s ? { state: s.state, room: s.roomNumber, name: s.claimedGuestName } : "none");
  console.log(s && s.state === "active" ? "FAIL - imposter became active on 305" : "PASS - imposter blocked from 305");
}

main().finally(() => prisma.$disconnect());
