import "dotenv/config";
import { prisma } from "../db";
import bcrypt from "bcryptjs";
async function main() {
  const rows: any[] = await prisma.$queryRawUnsafe(`select email, (password_hash is not null) as has_hash from staff_users where lower(email)=lower($1)`, "jyotiprovaghosh1706@gmail.com");
  console.log("RESULT >>> Rima row:", JSON.stringify(rows[0]));
  // does the OLD password still match?
  const h: any[] = await prisma.$queryRawUnsafe(`select password_hash from staff_users where lower(email)=lower($1)`, "jyotiprovaghosh1706@gmail.com");
  if (h[0]?.password_hash) {
    console.log("RESULT >>> 'rima12345' matches:", await bcrypt.compare("rima12345", h[0].password_hash));
  }
}
main().catch(e=>console.log("ERR",e.message)).finally(()=>prisma.$disconnect());