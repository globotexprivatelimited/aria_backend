import { prisma } from "../db";

async function main() {
  const rows = await prisma.session.findMany({
    where: { guestPhone: "+919999000002" },
    orderBy: { createdAt: "desc" },
  });
  console.log(
    rows.map((x) => ({
      state: x.state,
      room: x.roomNumber,
      name: x.claimedGuestName,
      verified: x.roomVerified,
      method: x.verificationMethod,
    }))
  );
}

main().finally(() => prisma.$disconnect());
