import "dotenv/config";
import { prisma } from "../db";
import bcrypt from "bcryptjs";
import { randomUUID } from "crypto";

async function main() {
  const NUMBER = "+918240755545";
  const PHONE_ID = "1211362652070297";

  const existing: any[] = await prisma.$queryRawUnsafe(
    `select "hotelId" from "Hotel" where "whatsappNumber" = $1`, NUMBER);
  if (existing[0]) { console.log("already exists as hotel", existing[0].hotelId); return; }

  const next: any[] = await prisma.$queryRawUnsafe(
    `select coalesce(max("hotelId"::int),0) + 1 as n from "Hotel" where "hotelId" ~ '^[0-9]+$'`);
  const id = String(next[0].n);
  const token = "htk_" + randomUUID().replace(/-/g, "").slice(0, 20);

  await prisma.$executeRawUnsafe(
    `insert into "Hotel"
       (id, "hotelId", name, city, address, "whatsappNumber", contact_email, contact_phone,
        check_in_time, check_out_time, room_count, onboarded, "isActive", "webhookToken",
        email_verified, "revenueSharePercent", whatsapp_phone_id, whatsapp_connected, plan_code, account_owner)
     values
       ($1, $2, $3, $4, $5, $6, $7, $8,
        $9, $10, $11, true, true, $12,
        true, 0, $13, true, 'standard', 'Mahasin')`,
    randomUUID(), id, "Globotex", "Kolkata", "5 & 6 Fancy Lane", NUMBER,
    "contact@globotex.co.in", "+919903610919",
    "14:00", "11:00", 20, token, PHONE_ID);

  await prisma.$executeRawUnsafe(
    `insert into staff_users (id, auth_user_id, hotel_id, role, full_name, email, phone, password_hash, is_active)
     values ($1::uuid, $2::uuid, $3, 'gm', 'Globotex Manager', 'globotex@aria.com', '+919903610919', $4, true)`,
    randomUUID(), randomUUID(), id, await bcrypt.hash("globotex12345", 10));

  for (const d of ["fb", "housekeeping", "spa", "front_desk", "dining", "maintenance"]) {
    await prisma.$executeRawUnsafe(
      `insert into hotel_departments (hotel_id, dept) select $1, $2
        where not exists (select 1 from hotel_departments where hotel_id=$1 and dept=$2)`, id, d);
    try {
      await prisma.$executeRawUnsafe(
        `insert into dept_config (hotel_id, dept, mode) values ($1,$2,$3)`,
        id, d, (d === "fb" || d === "housekeeping") ? "auto" : "accept_decline");
    } catch { /* already there */ }
  }

  const r: any[] = await prisma.$queryRawUnsafe(
    `select "hotelId", name, "whatsappNumber", whatsapp_phone_id from "Hotel" where "hotelId"=$1`, id);
  console.log("CREATED hotel", r[0].hotelId, "-", r[0].name);
  console.log("  number:  ", r[0].whatsappNumber);
  console.log("  phone id:", r[0].whatsapp_phone_id);
  console.log("  sign in:  globotex@aria.com / globotex12345");
}
main().catch((e)=>console.log("ERR", e.message)).finally(()=>prisma.$disconnect());
