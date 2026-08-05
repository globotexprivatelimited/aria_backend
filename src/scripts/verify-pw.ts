import "dotenv/config";
import { prisma } from "../db";
import bcrypt from "bcryptjs";
async function main() {
  const rows: any[] = await prisma.$queryRawUnsafe(`select email, password_hash from staff_users where lower(email)=lower($1)`, "mahasinkhan132@gmail.com");
  const u = rows[0];
  console.log("RESULT >>> row found:", !!u, "| has_hash:", !!u?.password_hash);
  if (u?.password_hash) {
    const match = await bcrypt.compare("mahasin12345", u.password_hash);
    console.log("RESULT >>> password 'mahasin12345' matches hash:", match);
  }
}
main().catch(e=>console.log("ERR",e.message)).finally(()=>prisma.$disconnect());