import "dotenv/config";
import { prisma } from "../db";
async function main() {
  const h: any[] = await prisma.$queryRawUnsafe(`select count(*)::text as n from "Hotel"`);
  const s: any[] = await prisma.$queryRawUnsafe(`select count(*)::text as n from staff_users`);
  const r: any[] = await prisma.$queryRawUnsafe(`select count(*)::text as n from "Request"`);
  const c: any[] = await prisma.$queryRawUnsafe(`select value::text as v from id_counters where name='hotel'`);
  console.log("RESULT >>> hotels:", h[0].n, "| staff:", s[0].n, "| requests:", r[0].n, "| counter:", c[0].v);
}
main().catch(console.error).finally(() => prisma.$disconnect());