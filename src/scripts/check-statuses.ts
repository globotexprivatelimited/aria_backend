import "dotenv/config";
import { prisma } from "../db";
async function main() {
  const rows: any[] = await prisma.$queryRawUnsafe(`select distinct status from "Request"`);
  console.log("statuses in use:", JSON.stringify(rows));
}
main().catch(console.error).finally(() => prisma.$disconnect());