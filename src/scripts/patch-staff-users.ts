import "dotenv/config";
import { prisma } from "../db";
async function main() {
  await prisma.$executeRawUnsafe(`alter table staff_users add column if not exists phone text`);
  await prisma.$executeRawUnsafe(`alter table staff_users add column if not exists full_name text`);
  console.log("staff_users columns patched (phone, full_name).");
}
main().catch(console.error).finally(() => prisma.$disconnect());