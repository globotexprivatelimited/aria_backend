import "dotenv/config";
import { prisma } from "../db";
import bcrypt from "bcryptjs";
async function main() {
  const h: any[] = await prisma.$queryRawUnsafe(`select password_hash from staff_users where lower(email)=lower($1)`, "jyotiprovaghosh1706@gmail.com");
  // check against whatever you just set it to in the UI - change this string to match
  const testPw = "rimanew123";
  console.log("RESULT >>> '" + testPw + "' matches:", h[0]?.password_hash ? await bcrypt.compare(testPw, h[0].password_hash) : "no hash");
}
main().catch(e=>console.log("ERR",e.message)).finally(()=>prisma.$disconnect());