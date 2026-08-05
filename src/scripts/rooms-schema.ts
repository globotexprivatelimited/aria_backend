import "dotenv/config";
import { prisma } from "../db";

async function main() {
  // rooms table: the hotel's room inventory + live status
  await prisma.$executeRawUnsafe(`
    create table if not exists rooms (
      id uuid primary key default gen_random_uuid(),
      hotel_id text not null,
      room_number text not null,
      room_type text not null default 'Standard',
      floor int not null default 1,
      status text not null default 'available',
      guest_name text,
      guest_phone text,
      party_size int,
      check_in timestamptz,
      check_out timestamptz,
      notes text,
      created_at timestamptz not null default now(),
      unique (hotel_id, room_number)
    )`);
  await prisma.$executeRawUnsafe(`create index if not exists rooms_hotel_idx on rooms (hotel_id)`);
  console.log("RESULT >>> rooms table ready");

  // verify
  const cols: any[] = await prisma.$queryRawUnsafe(`select column_name from information_schema.columns where table_name='rooms' order by ordinal_position`);
  console.log("RESULT >>> rooms cols:", cols.map((c:any)=>c.column_name).join(","));
}
main().catch(e=>console.log("ERR >>>",e.message)).finally(()=>prisma.$disconnect());