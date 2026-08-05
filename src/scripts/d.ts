import "dotenv/config";
import { prisma } from "../db";
async function main() {
  const cols: any[] = await prisma.$queryRawUnsafe(`select column_name from information_schema.columns where table_name='staff_users'`);
  console.log("STAFF_USERS COLUMNS:", cols.map((c:any)=>c.column_name).join(", "));
  const all: any[] = await prisma.$queryRawUnsafe(`select count(*) c from staff_users`);
  console.log("TOTAL staff_users rows:", all[0].c);
  const byHotel: any[] = await prisma.$queryRawUnsafe(`select hotel_id, count(*) c from staff_users group by hotel_id`);
  console.log("STAFF BY HOTEL:", JSON.stringify(byHotel));
  const sd: any[] = await prisma.$queryRawUnsafe(`select column_name from information_schema.columns where table_name='staff_departments'`);
  console.log("STAFF_DEPARTMENTS COLUMNS:", sd.map((c:any)=>c.column_name).join(", "));
}
main().catch(e=>console.log("ERR",e.message)).finally(()=>prisma.$disconnect());