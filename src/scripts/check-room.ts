import { prisma } from "../db";

async function main() {
  const rows = await prisma.session.findMany({
    where: { hotelId: "demo", roomNumber: "305" },
    orderBy: { createdAt: "desc" },
  });
  console.log("Sessions claiming Room 305:");
  for (const r of rows) {
    console.log("  phone=" + r.guestPhone + " state=" + r.state + " name=" + (r.claimedGuestName ?? "-") + " verified=" + r.roomVerified + " method=" + (r.verificationMethod ?? "-"));
  }

  const imposter = await prisma.session.findFirst({
    where: { hotelId: "demo", guestPhone: "+919777000111" },
    orderBy: { createdAt: "desc" },
  });
  console.log("\nImposter session:", imposter ? { state: imposter.state, room: imposter.roomNumber, name: imposter.claimedGuestName } : "none");
  console.log(imposter && imposter.state === "active" ? "RESULT: FAIL - imposter got active" : "RESULT: PASS - imposter blocked");
}

main().finally(() => prisma.$disconnect());
