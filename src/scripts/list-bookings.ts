import "dotenv/config";
import { prisma } from "../db";

async function main() {
  const rows = await prisma.diningBooking.findMany({
    where: { hotelId: "demo" },
    orderBy: { createdAt: "desc" },
    take: 15,
  });

  if (rows.length === 0) { console.log("No dining bookings yet."); return; }

  console.log("\nREF       STATUS               ROOM  PARTY  WHEN");
  console.log("--------  -------------------  ----  -----  ----------------------");
  for (const b of rows) {
    console.log(
      b.id.slice(0, 8) + "  " +
      b.status.padEnd(19) + "  " +
      (b.roomNumber ?? "-").padEnd(4) + "  " +
      String(b.partySize ?? "-").padEnd(5) + "  " +
      (b.bookingTime ?? "-")
    );
  }
  console.log("\nOpen bookings can take: CONFIRM <ref> [amount] | ALT <ref> <time> | DECLINE <ref> [reason]\n");
}

main().catch(console.error).finally(() => prisma.$disconnect());
