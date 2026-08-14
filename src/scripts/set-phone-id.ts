import "dotenv/config";
import { prisma } from "../db";
async function main() {
  const [hotelId, phoneId] = process.argv.slice(2);
  if (!hotelId || !phoneId) { console.log("Usage: npx tsx src/scripts/set-phone-id.ts 1 1135115139695123"); return; }
  await prisma.$executeRawUnsafe(
    `update "Hotel" set whatsapp_phone_id=$2, whatsapp_connected=true where "hotelId"=$1`, hotelId, phoneId);
  const r: any[] = await prisma.$queryRawUnsafe(
    `select "hotelId", name, whatsapp_phone_id from "Hotel" where "hotelId"=$1`, hotelId);
  console.log("set:", r[0]?.name, "->", r[0]?.whatsapp_phone_id);
}
main().catch((e)=>console.log("ERR", e.message)).finally(()=>prisma.$disconnect());
