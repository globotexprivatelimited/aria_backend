import "dotenv/config";
import { prisma } from "../db";

async function main() {
  const rows = await prisma.request.findMany({
    where: { hotelId: "demo", status: { in: ["received", "in_progress"] } },
    orderBy: { createdAt: "desc" },
    take: 12,
  });
  if (rows.length === 0) { console.log("No open requests."); return; }
  console.log("\nREF       DEPT          STATUS        ROOM  DETAIL");
  console.log("--------  ------------  ------------  ----  ------------------------------");
  for (const r of rows) {
    console.log(
      r.id.slice(0, 8) + "  " +
      String(r.department ?? "-").padEnd(12) + "  " +
      String(r.status).padEnd(12) + "  " +
      String(r.roomNumber ?? "-").padEnd(4) + "  " +
      (r.requestDetail ?? "-").slice(0, 40)
    );
  }
  console.log("\nType A (spa/front_desk): ACCEPT <ref> | REJECT <ref> <reason> | ALTERNATIVE <ref> <option>");
  console.log("Type B (housekeeping/fb): CLAIM <ref> | DONE <ref> | PROBLEM <ref>\n");
}

main().catch(console.error).finally(() => prisma.$disconnect());
