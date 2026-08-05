import "dotenv/config";
import { prisma } from "../db";

const statements = [
  // staff_users: links a Supabase Auth login to a role + hotel
  `create table if not exists staff_users (
    id uuid primary key default gen_random_uuid(),
    auth_user_id uuid not null unique,
    hotel_id text not null,
    role text not null,
    full_name text,
    phone text,
    is_active boolean default true,
    created_at timestamptz default now()
  )`,

  // hotel_departments: which departments each hotel runs (differs per hotel)
  `create table if not exists hotel_departments (
    id uuid primary key default gen_random_uuid(),
    hotel_id text not null,
    dept text not null,
    enabled boolean default true,
    staff_number text,
    created_at timestamptz default now(),
    unique (hotel_id, dept)
  )`,

  // new Hotel columns for full setup details (guard each so re-runs are safe)
  `alter table "Hotel" add column if not exists address text`,
  `alter table "Hotel" add column if not exists city text`,
  `alter table "Hotel" add column if not exists room_count integer`,
  `alter table "Hotel" add column if not exists check_in_time text`,
  `alter table "Hotel" add column if not exists check_out_time text`,
  `alter table "Hotel" add column if not exists contact_phone text`,
  `alter table "Hotel" add column if not exists onboarded boolean default false`,

  // RLS: staff read their own row
  `alter table staff_users enable row level security`,
  `drop policy if exists "read own staff row" on staff_users`,
  `create policy "read own staff row" on staff_users for select to authenticated using (auth.uid() = auth_user_id)`,

  // RLS: hotel_departments readable by that hotel's staff (or founder)
  `alter table hotel_departments enable row level security`,
  `drop policy if exists "read hotel departments" on hotel_departments`,
  `create policy "read hotel departments" on hotel_departments for select to authenticated using (exists (select 1 from staff_users s where s.auth_user_id = auth.uid() and (s.role = 'founder' or s.hotel_id = hotel_departments.hotel_id)))`,
];

async function main() {
  for (const sql of statements) {
    try {
      await prisma.$executeRawUnsafe(sql);
      console.log("ok  :", sql.replace(/\s+/g, " ").slice(0, 64));
    } catch (e) {
      console.log("note:", (e instanceof Error ? e.message : String(e)).slice(0, 90));
    }
  }
  console.log("\nSchema ready: staff_users, hotel_departments, Hotel setup columns, RLS.");
}

main().catch(console.error).finally(() => prisma.$disconnect());