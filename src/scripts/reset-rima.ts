import "dotenv/config";
import { prisma } from "../db";
import bcrypt from "bcryptjs";
async function main() {
  const hash = await bcrypt.hash("rima12345", 10);
  await prisma.$executeRawUnsafe(`update staff_users set password_hash=$1 where lower(email)=lower($2)`, hash, "jyotiprovaghosh1706@gmail.com");
  console.log("RESULT >>> Rima password reset to rima12345 in your auth system");
}
main().catch(e=>console.log("ERR",e.message)).finally(()=>prisma.$disconnect());