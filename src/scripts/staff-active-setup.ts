import "dotenv/config";
import { prisma } from "../db";
async function main() {
  // 1. discover the real column names
  const cols: any[] = await prisma.$queryRawUnsafe(`select column_name from information_schema.columns where table_name='staff_departments'`);
  const names = cols.map((c:any)=>c.column_name);
  console.log("COLUMNS:", names.join(", "));

  // 2. add active flag if missing (safe, additive)
  await prisma.$executeRawUnsafe(`alter table staff_departments add column if not exists active boolean not null default true`);
  console.log("ACTIVE COLUMN: ready");

  // 3. figure out which column is the staff link and which is the dept
  const staffCol = names.find((n:string)=>/staff.*id|user.*id/i.test(n)) || "staff_user_id";
  const deptCol = names.find((n:string)=>/dept|depart/i.test(n)) || "dept";
  console.log("STAFF COLUMN:", staffCol, "| DEPT COLUMN:", deptCol);

  // 4. show current assignments so we see it works
  const rows: any[] = await prisma.$queryRawUnsafe(`select * from staff_departments limit 5`);
  console.log("CURRENT ASSIGNMENTS:", JSON.stringify(rows));
}
main().catch(e=>console.log("ERROR:",e.message)).finally(()=>prisma.$disconnect());