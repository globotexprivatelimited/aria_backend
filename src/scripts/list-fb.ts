import "dotenv/config";
import { prisma } from "../db";

async function main() {
  const rows = await prisma.request.findMany({
    where: { hotelId: "demo", department: "fb" },
    orderBy: { createdAt: "desc" },
    take: 5,
  });
  if (rows.length === 0) { console.log("No in-room dining requests yet."); return; }
  for (const r of rows) console.log(r.id.slice(0, 8), "room", r.roomNumber, r.status, "-", r.requestDetail);
}

main().catch(console.error).finally(() => prisma.$disconnect());
