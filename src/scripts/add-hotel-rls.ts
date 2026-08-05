import "dotenv/config";
import { prisma } from "../db";
async function main() {
  await prisma.$executeRawUnsafe(`alter table "Hotel" enable row level security`);
  await prisma.$executeRawUnsafe(`drop policy if exists "gm reads own hotel" on "Hotel"`);
  // a signed-in user can read a Hotel row only if it is their own hotel (matched via staff_users)
  await prisma.$executeRawUnsafe(`
    create policy "gm reads own hotel" on "Hotel" for select to authenticated
    using (exists (select 1 from staff_users s where s.auth_user_id = auth.uid()
                   and (s.role = 'founder' or s.hotel_id = "Hotel"."hotelId")))
  `);
  console.log("Hotel RLS policy added: a GM can read their own hotel row.");
}
main().catch(console.error).finally(() => prisma.$disconnect());