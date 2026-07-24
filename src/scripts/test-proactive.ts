import "dotenv/config";
import { prisma } from "../db";
import { sendDueTriggers } from "../proactive";

async function main() {
  const pending = await prisma.proactiveTrigger.findMany({
    where: { hotelId: "demo" },
    orderBy: { scheduledAt: "asc" },
    take: 20,
  });

  console.log("\nSCHEDULED MESSAGES");
  console.log("TYPE                   STATUS     WHEN");
  console.log("---------------------  ---------  -------------------");
  for (const t of pending) {
    console.log(
      t.triggerType.padEnd(21) + "  " +
      t.status.padEnd(9) + "  " +
      (t.scheduledAt ? t.scheduledAt.toISOString().slice(0, 19) : "-")
    );
  }

  console.log("\nBringing all pending messages due now...");
  await prisma.proactiveTrigger.updateMany({
    where: { hotelId: "demo", status: "pending" },
    data: { scheduledAt: new Date(Date.now() - 1000) },
  });

  await sendDueTriggers();
  console.log("\nDone - the sent messages are in the log above.\n");
}

main().catch(console.error).finally(() => prisma.$disconnect());
