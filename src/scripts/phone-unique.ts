import "dotenv/config";
import { prisma } from "../db";
async function main() {
  // one number belongs to exactly one hotel
  await prisma.$executeRawUnsafe(
    `create unique index if not exists hotel_phone_id_unique on "Hotel" (whatsapp_phone_id) where whatsapp_phone_id is not null`);
  console.log("unique constraint added - a phone id can now only belong to one hotel");
}
main().catch((e)=>console.log("ERR", e.message)).finally(()=>prisma.$disconnect());
