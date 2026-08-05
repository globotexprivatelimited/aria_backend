import "dotenv/config";
import { prisma } from "../db";
async function main() {
  // get a staff member's real id + how they're stored
  const cols: any[] = await prisma.$queryRawUnsafe(`select column_name from information_schema.columns where table_name='staff_departments'`);
  console.log("STAFFDEPT_COLS:", cols.map((c:any)=>c.column_name).join(","));
  const sd: any[] = await prisma.$queryRawUnsafe(`select * from staff_departments limit 3`);
  console.log("STAFFDEPT_SAMPLE:", JSON.stringify(sd));
  // staff_users id sample
  const su: any[] = await prisma.$queryRawUnsafe(`select id from staff_users limit 2`);
  console.log("STAFF_IDS:", JSON.stringify(su));
}
main().catch(e=>console.log("ERR",e.message)).finally(()=>prisma.$disconnect());