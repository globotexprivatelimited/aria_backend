import "dotenv/config";
import { prisma } from "../db";
async function main() {
  const rows: any[] = await prisma.$queryRawUnsafe(`select name, value::text as value from id_counters where name='hotel'`);
  console.log("hotel counter:", JSON.stringify(rows));
}
main().catch(console.error).finally(() => prisma.$disconnect());