import "dotenv/config";
import { prisma } from "../db";
async function main() {
  const keep = process.argv[2];
  if (!keep) { console.log("Usage: npx tsx src/scripts/only-one-phone.ts 1"); return; }
  await prisma.$executeRawUnsafe(
    `update "Hotel" set whatsapp_phone_id=null, whatsapp_connected=false where "hotelId" <> $1`, keep);
  const r: any[] = await prisma.$queryRawUnsafe(
    `select "hotelId", name, whatsapp_phone_id from "Hotel" where whatsapp_phone_id is not null`);
  console.log("hotels with a phone id:", r.length);
  r.forEach((x:any)=>console.log("  hotel", x.hotelId, x.name, "->", x.whatsapp_phone_id));
}
main().catch((e)=>console.log("ERR", e.message)).finally(()=>prisma.$disconnect());
