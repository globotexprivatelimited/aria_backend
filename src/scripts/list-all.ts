import "dotenv/config";
import { prisma } from "../db";
async function main() {
  const all: any[] = await prisma.$queryRawUnsafe(`select email, role, hotel_id, (password_hash is not null) as has_pw from staff_users order by created_at`);
  console.log("RESULT >>> all staff_users:", JSON.stringify(all));
}
main().catch(e=>console.log("ERR",e.message)).finally(()=>prisma.$disconnect());