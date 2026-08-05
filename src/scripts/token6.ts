import "dotenv/config";
import { prisma } from "../db";
async function main() {
  const h: any[] = await prisma.$queryRawUnsafe(`select "hotelId", "webhookToken" from "Hotel" where "hotelId"='6'`);
  console.log(JSON.stringify(h));
}
main().catch(console.error).finally(() => prisma.$disconnect());