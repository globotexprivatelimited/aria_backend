import "dotenv/config";
import { prisma } from "../db";
async function main() {
  // add hotel contact email (where reset links go)
  await prisma.$executeRawUnsafe(`alter table "Hotel" add column if not exists contact_email text`);
  console.log("contact_email column: ready");
  // seed hotel 1's contact email with the GM's email as a sensible default (GM can change it)
  await prisma.$executeRawUnsafe(`update "Hotel" set contact_email = (select email from staff_users where hotel_id='1' and role='gm' limit 1) where "hotelId"='1' and contact_email is null`);
  const h: any[] = await prisma.$queryRawUnsafe(`select "hotelId", contact_email from "Hotel" where "hotelId"='1'`);
  console.log("HOTEL 1 contact_email:", JSON.stringify(h));
  // create reset tokens table
  await prisma.$executeRawUnsafe(`
    create table if not exists password_reset_tokens (
      id uuid primary key default gen_random_uuid(),
      staff_user_id uuid not null,
      token text not null unique,
      expires_at timestamptz not null,
      used boolean not null default false,
      created_at timestamptz not null default now()
    )`);
  await prisma.$executeRawUnsafe(`create index if not exists prt_token_idx on password_reset_tokens (token)`);
  console.log("password_reset_tokens table: ready");
}
main().catch(e=>console.log("ERR",e.message)).finally(()=>prisma.$disconnect());