import "dotenv/config";
import { prisma } from "../db";

const statements = [
  // a staffer can be assigned to MANY departments - one row per (staffer, dept)
  `create table if not exists staff_departments (
    id uuid primary key default gen_random_uuid(),
    staff_user_id uuid not null,
    dept text not null,
    created_at timestamptz default now(),
    unique (staff_user_id, dept)
  )`,
  // RLS: a signed-in staffer reads only their own department assignments
  `alter table staff_departments enable row level security`,
  `drop policy if exists "read own staff departments" on staff_departments`,
  `create policy "read own staff departments" on staff_departments for select to authenticated
     using (exists (select 1 from staff_users s where s.id = staff_departments.staff_user_id and s.auth_user_id = auth.uid()))`,
];

async function main() {
  for (const sql of statements) {
    try { await prisma.$executeRawUnsafe(sql); console.log("ok  :", sql.replace(/\s+/g, " ").slice(0, 60)); }
    catch (e) { console.log("note:", (e instanceof Error ? e.message : String(e)).slice(0, 80)); }
  }
  console.log("\nstaff_departments ready (multi-department staff).");
}
main().catch(console.error).finally(() => prisma.$disconnect());