import "dotenv/config";
import { prisma } from "../db";
async function main() {
  const bad: any[] = await prisma.$queryRawUnsafe(`select id, hotel_id, role, email from staff_users where role is null or email is null`);
  console.log("RESULT >>> rows with null role/email:", JSON.stringify(bad));
  const test: any[] = await prisma.$queryRawUnsafe(`select email from staff_users where lower(email) = lower('testowner@newhotel.com')`);
  console.log("RESULT >>> testowner exists:", test.length > 0);
}
main().catch(e=>console.log("ERR",e.message)).finally(()=>prisma.$disconnect());