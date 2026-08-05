import "dotenv/config";
import { prisma } from "../db";
async function main() {
  // find the actual staff-dept table + its columns first
  const cols: any[] = await prisma.$queryRawUnsafe(`select column_name from information_schema.columns where table_name='staff_departments' order by ordinal_position`);
  console.log("STAFFDEPT COLS:", cols.map((c:any)=>c.column_name).join(","));
  // add active flag (default true so existing assignments stay active)
  await prisma.$executeRawUnsafe(`alter table staff_departments add column if not exists active boolean not null default true`);
  const after: any[] = await prisma.$queryRawUnsafe(`select column_name from information_schema.columns where table_name='staff_departments'`);
  console.log("HAS ACTIVE NOW:", after.map((c:any)=>c.column_name).includes("active"));
  const sample: any[] = await prisma.$queryRawUnsafe(`select * from staff_departments limit 3`);
  console.log("SAMPLE:", JSON.stringify(sample));
}
main().catch(e=>console.log("ERR:",e.message)).finally(()=>prisma.$disconnect());