import "dotenv/config";
import { prisma } from "../db";
import { randomUUID } from "crypto";
import bcrypt from "bcryptjs";
async function main() {
  const authUserId = randomUUID();
  const hash = await bcrypt.hash("test12345", 10);
  try {
    await prisma.$executeRawUnsafe(
      `insert into staff_users (auth_user_id, hotel_id, role, full_name, phone, email, password_hash) values ($1::uuid, $2, $3, $4, $5, $6, $7)`,
      authUserId, "", "gm", "Test GM", null, "isolate@test.com", hash
    );
    console.log("RESULT >>> GM insert with hotel_id='' SUCCEEDED");
    await prisma.$executeRawUnsafe(`delete from staff_users where email='isolate@test.com'`);
  } catch (e) {
    console.log("RESULT >>> GM insert FAILED:", e instanceof Error ? e.message : String(e));
  }
}
main().catch(e=>console.log("ERR",e.message)).finally(()=>prisma.$disconnect());