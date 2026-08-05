import "dotenv/config";
import { prisma } from "../db";
async function main() {
  const n: any[] = await prisma.$queryRawUnsafe(`select count(*) c from rooms where hotel_id='1'`);
  console.log("RESULT >>> rooms in DB for hotel 1:", n[0].c);
  const target: any[] = await prisma.$queryRawUnsafe(`select room_count from "Hotel" where "hotelId"='1'`);
  console.log("RESULT >>> registered target:", target[0].room_count);
}
main().catch(e=>console.log("ERR",e.message)).finally(()=>prisma.$disconnect());