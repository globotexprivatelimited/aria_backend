import "dotenv/config";
import { prisma } from "../db";

async function main() {
  const rows = await prisma.activityBooking.findMany({
    where: { hotelId: "demo" },
    orderBy: { createdAt: "desc" },
    take: 15,
  });

  if (rows.length === 0) {
    console.log("No activity bookings yet.");
  } else {
    console.log("\nREF       STATUS      ROOM  PARTY  ACTIVITY");
    console.log("--------  ----------  ----  -----  ------------------------------");
    for (const b of rows) {
      console.log(
        b.id.slice(0, 8) + "  " +
        b.status.padEnd(10) + "  " +
        (b.roomNumber ?? "-").padEnd(4) + "  " +
        String(b.partySize ?? "-").padEnd(5) + "  " +
        (b.activityName ?? "-").slice(0, 40)
      );
    }
  }

  const queue = await prisma.activityWaitlist.findMany({
    where: { hotelId: "demo" },
    orderBy: [{ activityName: "asc" }, { position: "asc" }],
  });

  if (queue.length > 0) {
    console.log("\nWAITLIST");
    console.log("POS  ROOM  HELD UNTIL           ACTIVITY");
    console.log("---  ----  -------------------  ------------------------------");
    for (const w of queue) {
      console.log(
        String(w.position ?? "-").padEnd(3) + "  " +
        (w.roomNumber ?? "-").padEnd(4) + "  " +
        (w.holdUntil ? w.holdUntil.toISOString().slice(0, 19) : "not offered yet").padEnd(19) + "  " +
        (w.activityName ?? "-").slice(0, 40)
      );
    }
  }

  console.log("\nCommands: CONFIRM <ref> <price> | WAITLIST <ref> | DECLINE <ref> | CANCEL <ref>\n");
}

main().catch(console.error).finally(() => prisma.$disconnect());
