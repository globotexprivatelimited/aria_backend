import "dotenv/config";
import { prisma } from "../db";
async function main() {
  // remove all rooms for hotel 1 (the dummy 120 + occupancy)
  const r = await prisma.$executeRawUnsafe(`delete from rooms where hotel_id='1'`);
  console.log("RESULT >>> rooms deleted:", r);
  // remove the fake test Sessions I created via check-in (P. Verma etc.) - only the ones with no real conversation
  const testPhones = ['+919876543210','+919000000000'];
  for (const p of testPhones) {
    await prisma.$executeRawUnsafe(`delete from "Session" where "guestPhone"=$1 and ("conversationHistory" is null or "conversationHistory"::text in ('[]','{}','null'))`, p);
  }
  const remaining: any[] = await prisma.$queryRawUnsafe(`select count(*) n from rooms where hotel_id='1'`);
  console.log("RESULT >>> rooms remaining for hotel 1:", remaining[0].n);
  const sess: any[] = await prisma.$queryRawUnsafe(`select count(*) n from "Session"`);
  console.log("RESULT >>> total sessions:", sess[0].n);
}
main().catch(e=>console.log("ERR >>>",e.message)).finally(()=>prisma.$disconnect());