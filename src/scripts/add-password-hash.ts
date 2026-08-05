import "dotenv/config";
import { prisma } from "../db";
async function main() {
  await prisma.$executeRawUnsafe(`alter table staff_users add column if not exists password_hash text`);
  console.log("password_hash column ready.");
}
main().catch(console.error).finally(() => prisma.$disconnect());