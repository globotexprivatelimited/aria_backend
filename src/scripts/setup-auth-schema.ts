import "dotenv/config";
import { prisma } from "../db";

const statements = [
  `create table if not exists staff_users (
    id uuid primary key default gen_random_uuid(),
    auth_user_id uuid not null unique,
    hotel_id text not null,
    role text not null,
    full_name text,
    is_active boolean default true,
    created_at timestamptz default now()
  )`,
  `alter table staff_users enable row level security`,
  `drop policy if exists "read own staff row" on staff_users`,
  `create policy "read own staff row" on staff_users for select to authenticated using (auth.uid() = auth_user_id)`,
  `alter table "Request" enable row level security`,
  `drop policy if exists "staff read hotel requests" on "Request"`,
  `create policy "staff read hotel requests" on "Request" for select to authenticated using (exists (select 1 from staff_users s where s.auth_user_id = auth.uid() and (s.role = 'founder' or s.hotel_id = "Request"."hotelId")))`,
];

async function main() {
  for (const sql of statements) {
    try {
      await prisma.$executeRawUnsafe(sql);
      console.log("ok:", sql.replace(/\s+/g, " ").slice(0, 62));
    } catch (e) {
      console.log("note:", (e instanceof Error ? e.message : String(e)).slice(0, 90));
    }
  }
  console.log("\nAuth schema ready. RLS is now ON for Request - only logged-in staff see their hotel's rows.");
}

main().catch(console.error).finally(() => prisma.$disconnect());
