import "dotenv/config";
import { prisma } from "../db";
async function main() {
  const s: any[] = await prisma.$queryRawUnsafe(`select "guestPhone", "roomNumber", "guestName", "roomVerified", "state"::text, "checkOutDate" from "Session" where "guestPhone"=$1`, "+919876543210");
  console.log("RESULT >>> Session for guest:", JSON.stringify(s));
}
main().catch(e=>console.log("ERR",e.message)).finally(()=>prisma.$disconnect());