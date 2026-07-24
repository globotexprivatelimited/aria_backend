import "dotenv/config";
import { prisma } from "../db";

async function main() {
  const r = await prisma.request.deleteMany({ where: { hotelId: "demo" } });
  console.log("Deleted " + r.count + " request(s).");
}

main().catch(console.error).finally(() => prisma.$disconnect());
