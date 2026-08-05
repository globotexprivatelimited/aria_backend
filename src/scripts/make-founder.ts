import "dotenv/config";
import { prisma } from "../db";
async function main() {
  const email = "founder@aria.com";
  // find the auth user id via staff_users is not by email; update by matching the most recent gm with this... 
  // simpler: set role=founder for the staff_users row whose auth user has this email is not directly joinable here,
  // so update by the authUserId we just created - pass it in.
  const authId = process.argv[2];
  if (!authId) { console.log("pass the authUserId as an argument"); return; }
  await prisma.$executeRawUnsafe(`update staff_users set role='founder', hotel_id='' where auth_user_id=$1::uuid`, authId);
  const row: any[] = await prisma.$queryRawUnsafe(`select role, full_name from staff_users where auth_user_id=$1::uuid`, authId);
  console.log("updated:", JSON.stringify(row));
}
main().catch(console.error).finally(() => prisma.$disconnect());