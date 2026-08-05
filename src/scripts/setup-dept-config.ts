import "dotenv/config";
import { prisma } from "../db";

const statements = [
  // MENU ITEMS - for In-Room Dining and other food departments
  `create table if not exists menu_items (
    id uuid primary key default gen_random_uuid(),
    hotel_id text not null,
    dept text not null,
    name text not null,
    category text,
    price numeric(10,2) not null default 0,
    stock integer not null default 0,
    available boolean not null default true,
    sort_order integer not null default 0,
    created_at timestamptz default now()
  )`,
  `create index if not exists menu_items_hotel_dept on menu_items (hotel_id, dept)`,
  `alter table menu_items enable row level security`,
  `drop policy if exists "gm manages own menu" on menu_items`,
  // a signed-in GM/staff of this hotel can read+write its menu (matched via staff_users)
  `create policy "gm manages own menu" on menu_items for all to authenticated
     using (exists (select 1 from staff_users s where s.auth_user_id = auth.uid() and s.hotel_id = menu_items.hotel_id))
     with check (exists (select 1 from staff_users s where s.auth_user_id = auth.uid() and s.hotel_id = menu_items.hotel_id))`,

  // TIME SLOTS - for Spa and other appointment departments
  `create table if not exists time_slots (
    id uuid primary key default gen_random_uuid(),
    hotel_id text not null,
    dept text not null,
    label text not null,
    start_time text not null,
    capacity integer not null default 1,
    active boolean not null default true,
    sort_order integer not null default 0,
    created_at timestamptz default now()
  )`,
  `create index if not exists time_slots_hotel_dept on time_slots (hotel_id, dept)`,
  `alter table time_slots enable row level security`,
  `drop policy if exists "gm manages own slots" on time_slots`,
  `create policy "gm manages own slots" on time_slots for all to authenticated
     using (exists (select 1 from staff_users s where s.auth_user_id = auth.uid() and s.hotel_id = time_slots.hotel_id))
     with check (exists (select 1 from staff_users s where s.auth_user_id = auth.uid() and s.hotel_id = time_slots.hotel_id))`,
];

async function main() {
  for (const sql of statements) {
    try { await prisma.$executeRawUnsafe(sql); console.log("ok  :", sql.replace(/\s+/g, " ").slice(0, 55)); }
    catch (e) { console.log("note:", (e instanceof Error ? e.message : String(e)).slice(0, 70)); }
  }
  console.log("\nmenu_items + time_slots ready.");
}
main().catch(console.error).finally(() => prisma.$disconnect());