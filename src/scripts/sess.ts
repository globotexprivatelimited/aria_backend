import "dotenv/config";
import { prisma } from "../db";
async function main() {
  // find where sessions are looked up - show a session's shape
  const s: any[] = await prisma.$queryRawUnsafe(`select count(*) n from "Session" where hotel_id_exists is null`).catch(()=>[{n:"?"}]);
  const cols: any[] = await prisma.$queryRawUnsafe(`select column_name, data_type from information_schema.columns where table_name='Session' order by ordinal_position`);
  console.log("RESULT >>> Session key cols:", cols.filter((c:any)=>["hotelId","guestPhone","roomNumber","guestName","checkOutDate","customCheckoutTime","roomVerified","state"].includes(c.column_name)).map((c:any)=>c.column_name+":"+c.data_type).join(", "));
  const cnt: any[] = await prisma.$queryRawUnsafe(`select count(*) n from "Session"`);
  console.log("RESULT >>> total sessions:", cnt[0].n);
}
main().catch(e=>console.log("ERR",e.message)).finally(()=>prisma.$disconnect());