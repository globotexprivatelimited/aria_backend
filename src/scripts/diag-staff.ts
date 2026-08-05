import "dotenv/config";
import { prisma } from "../db";
async function main() {
  // my query used staff_users - does it have rows for hotel 1?
  try {
    const su: any[] = await prisma.$queryRawUnsafe(`select count(*) c from staff_users where hotel_id='1'`);
    console.log("STAFF_USERS for hotel 1:", su[0].c);
    const cols: any[] = await prisma.$queryRawUnsafe(`select column_name from information_schema.columns where table_name='staff_users'`);
    console.log("STAFF_USERS COLS:", cols.map((c:any)=>c.column_name).join(","));
    const sample: any[] = await prisma.$queryRawUnsafe(`select * from staff_users where hotel_id='1' limit 2`);
    console.log("SAMPLE:", JSON.stringify(sample));
  } catch(e) { console.log("staff_users ERR:", (e as Error).message); }
  // staff_departments structure
  try {
    const sd: any[] = await prisma.$queryRawUnsafe(`select * from staff_departments limit 3`);
    console.log("STAFF_DEPTS SAMPLE:", JSON.stringify(sd));
  } catch(e) { console.log("staff_departments ERR:", (e as Error).message); }
}
main().catch(e=>console.log("ERR",e.message)).finally(()=>prisma.$disconnect());