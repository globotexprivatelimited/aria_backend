import "dotenv/config";
import { prisma } from "../db";
import { supabaseAdmin } from "../lib/supabaseAdmin";

async function main() {
  // add the column
  await prisma.$executeRawUnsafe(`alter table staff_users add column if not exists email text`);
  console.log("email column ready.");

  // backfill: for each row missing email, fetch it from Supabase Auth by auth_user_id
  const rows: any[] = await prisma.$queryRawUnsafe(`select id, auth_user_id from staff_users where email is null and auth_user_id is not null`);
  console.log("rows needing email:", rows.length);
  for (const r of rows) {
    try {
      const { data, error } = await supabaseAdmin.auth.admin.getUserById(r.auth_user_id);
      if (error || !data?.user?.email) { console.log("  no email for", r.id); continue; }
      await prisma.$executeRawUnsafe(`update staff_users set email = $1 where id = $2::uuid`, data.user.email, r.id);
      console.log("  set", data.user.email, "for", r.id);
    } catch (e) { console.log("  err", r.id, (e instanceof Error ? e.message : String(e)).slice(0,40)); }
  }
  // show result
  const after: any[] = await prisma.$queryRawUnsafe(`select email, role, hotel_id, (password_hash is not null) as has_pw from staff_users order by created_at`);
  console.log("RESULT >>> staff_users:", JSON.stringify(after));
}
main().catch(e=>console.log("ERR >>>", e.message)).finally(() => prisma.$disconnect());