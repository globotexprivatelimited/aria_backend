import "dotenv/config";
import { prisma } from "../db";
async function main() {
  // how are staff-department links stored now?
  const tables: any[] = await prisma.$queryRawUnsafe(`select table_name from information_schema.tables where table_schema='public' and (table_name ilike '%staff%dept%' or table_name ilike '%staff_dep%' or table_name='staff_departments')`);
  console.log("RESULT >>> staff-dept tables:", tables.map((t:any)=>t.table_name).join(",") || "NONE");
  // staff_departments columns (the grep earlier showed this table exists)
  try {
    const cols: any[] = await prisma.$queryRawUnsafe(`select column_name from information_schema.columns where table_name='staff_departments' order by ordinal_position`);
    console.log("RESULT >>> staff_departments cols:", cols.map((c:any)=>c.column_name).join(","));
    const rows: any[] = await prisma.$queryRawUnsafe(`select * from staff_departments limit 5`);
    console.log("RESULT >>> sample rows:", JSON.stringify(rows));
  } catch(e){ console.log("RESULT >>> no staff_departments table:", (e as Error).message.slice(0,40)); }
  // does it have an 'active' column already?
  try {
    const has: any[] = await prisma.$queryRawUnsafe(`select column_name from information_schema.columns where table_name='staff_departments' and column_name='active'`);
    console.log("RESULT >>> has active column:", has.length > 0);
  } catch { console.log("check active failed"); }
}
main().catch(e=>console.log("ERR",e.message)).finally(()=>prisma.$disconnect());