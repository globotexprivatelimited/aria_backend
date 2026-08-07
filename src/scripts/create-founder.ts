import "dotenv/config";
import { prisma } from "../db";
import bcrypt from "bcryptjs";
import { randomUUID } from "crypto";

// Usage: npx tsx src/scripts/create-founder.ts <email> <password> "<full name>"
async function main() {
  const [email, password, ...nameParts] = process.argv.slice(2);
  const fullName = nameParts.join(" ") || "Founder";
  if (!email || !password) { console.log('Usage: npx tsx src/scripts/create-founder.ts <email> <password> "<full name>"'); return; }
  if (password.length < 8) { console.log("Use a password of at least 8 characters."); return; }

  const existing = await prisma.$queryRawUnsafe<any[]>(
    `select id, role from staff_users where lower(email)=lower($1) limit 1`, email.trim());

  if (existing[0]) {
    await prisma.$executeRawUnsafe(
      `update staff_users set role='founder', password_hash=$2, full_name=$3, is_active=true where id=$1::uuid`,
      existing[0].id, await bcrypt.hash(password, 10), fullName);
    console.log("Promoted the existing account to founder:", email);
  } else {
    // hotel_id '1' keeps every existing query happy; the founder queries across hotels explicitly
    await prisma.$executeRawUnsafe(
      `insert into staff_users (id, auth_user_id, hotel_id, role, full_name, email, password_hash, is_active)
       values ($1::uuid, $2::uuid, '1', 'founder', $3, $4, $5, true)`,
      randomUUID(), randomUUID(), fullName, email.trim(), await bcrypt.hash(password, 10));
    console.log("Created the founder account:", email);
  }

  const check = await prisma.$queryRawUnsafe<any[]>(
    `select full_name, email, role, hotel_id, is_active from staff_users where lower(email)=lower($1)`, email.trim());
  console.log(JSON.stringify(check[0], null, 2));
}
main().catch((e) => console.log("ERR", e.message)).finally(() => prisma.$disconnect());
