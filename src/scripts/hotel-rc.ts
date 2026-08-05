import "dotenv/config";
import { prisma } from "../db";
async function main() {
  // what did registration store on the Hotel? room_count?
  const h: any[] = await prisma.$queryRawUnsafe(`select "hotelId", name, room_count from "Hotel" where "hotelId"='1'`);
  console.log("RESULT >>> Hotel 1:", JSON.stringify(h));
  // all hotels' room_count
  const all: any[] = await prisma.$queryRawUnsafe(`select "hotelId", name, room_count from "Hotel" order by "hotelId"`);
  console.log("RESULT >>> all hotels room_count:", JSON.stringify(all.map((r:any)=>({id:r.hotelId,n:r.name,rc:r.room_count}))));
}
main().catch(e=>console.log("ERR",e.message)).finally(()=>prisma.$disconnect());