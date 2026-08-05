import "dotenv/config";
import { prisma } from "../db";
async function main() {
  await prisma.$executeRawUnsafe(`
    create table if not exists dept_items (
      id uuid primary key default gen_random_uuid(),
      hotel_id text not null,
      dept text not null,
      kind text not null default 'service',
      name text not null,
      description text,
      price numeric,
      stock int,
      unit text,
      duration_min int,
      available boolean not null default true,
      sort_order int not null default 0,
      created_at timestamptz not null default now()
    )`);
  await prisma.$executeRawUnsafe(`create index if not exists dept_items_hotel_dept_idx on dept_items (hotel_id, dept)`);
  console.log("RESULT >>> dept_items table ready");
  const cols: any[] = await prisma.$queryRawUnsafe(`select column_name from information_schema.columns where table_name='dept_items' order by ordinal_position`);
  console.log("RESULT >>> cols:", cols.map((c:any)=>c.column_name).join(","));
}
main().catch(e=>console.log("ERR >>>",e.message)).finally(()=>prisma.$disconnect());