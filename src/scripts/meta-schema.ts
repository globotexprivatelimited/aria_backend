import "dotenv/config";
import { prisma } from "../db";
async function main() {
  await prisma.$executeRawUnsafe(`alter table "Hotel" add column if not exists whatsapp_phone_id text`);
  await prisma.$executeRawUnsafe(`alter table "Hotel" add column if not exists whatsapp_connected boolean default false`);
  await prisma.$executeRawUnsafe(`create index if not exists hotel_phone_id_idx on "Hotel" (whatsapp_phone_id)`);

  // the number Meta gave you belongs to Royal Palace for now
  const pid = process.argv[2];
  if (pid) {
    await prisma.$executeRawUnsafe(
      `update "Hotel" set whatsapp_phone_id=$2, whatsapp_connected=true where "hotelId"='1'`, "1", pid);
    console.log("assigned phone id to Royal Palace");
  }

  const h: any[] = await prisma.$queryRawUnsafe(
    `select "hotelId", name, "whatsappNumber", whatsapp_phone_id, whatsapp_connected from "Hotel" order by "hotelId"`);
  h.forEach((x:any)=>console.log("  hotel", x.hotelId, "|", x.name, "| number:", x.whatsappNumber ?? "-", "| phone id:", x.whatsapp_phone_id ?? "not set"));
}
main().catch((e)=>console.log("ERR", e.message)).finally(()=>prisma.$disconnect());
