import "dotenv/config";
import { prisma } from "../db";
import bcrypt from "bcryptjs";

// known passwords for the two existing accounts (they can change later)
const ACCOUNTS = [
  { email: "mahasinkhan132@gmail.com", password: "mahasin12345" },
  { email: "jyotiprovaghosh1706@gmail.com", password: "rima12345" },
];
async function main() {
  for (const a of ACCOUNTS) {
    const hash = await bcrypt.hash(a.password, 10);
    await prisma.$executeRawUnsafe(`update staff_users set password_hash = $1 where lower(email) = lower($2)`, hash, a.email);
    console.log("set password for", a.email);
  }
  const rows: any[] = await prisma.$queryRawUnsafe(`select email, role, (password_hash is not null) as has_pw from staff_users order by created_at`);
  console.log("RESULT >>>", JSON.stringify(rows));
}
main().catch(e=>console.log("ERR >>>", e.message)).finally(()=>prisma.$disconnect());