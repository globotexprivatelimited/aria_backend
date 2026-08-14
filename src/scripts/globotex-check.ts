import "dotenv/config";
import { prisma } from "../db";
async function main() {
  const r: any[] = await prisma.$queryRawUnsafe(
    `select "roomNumber", department::text d, "requestDetail", status::text s, "createdAt"
       from "Request" where "hotelId"='16' order by "createdAt" desc limit 5`);
  console.log("REQUESTS AT GLOBOTEX:", r.length);
  r.forEach((x:any)=>console.log("  room " + x.roomNumber + " | " + x.d + " | " + x.requestDetail + " | " + x.s));
  const m: any[] = await prisma.$queryRawUnsafe(
    `select direction, body from "Message" where "hotelId"='16' order by "createdAt" desc limit 6`);
  console.log("RECENT MESSAGES:");
  m.forEach((x:any)=>console.log("  " + x.direction + ": " + String(x.body ?? "").slice(0,90)));
}
main().catch((e)=>console.log("ERR", e.message)).finally(()=>prisma.$disconnect());
