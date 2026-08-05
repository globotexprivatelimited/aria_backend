import "dotenv/config";
import { prisma } from "../db";
async function main() {
  await prisma.$executeRawUnsafe(`delete from staff_departments where staff_user_id in (select id from staff_users where hotel_id != '1')`);
  await prisma.$executeRawUnsafe(`delete from staff_users where hotel_id != '1'`);
  await prisma.$executeRawUnsafe(`delete from "Hotel" where "hotelId" != '1'`);
  const c: any[] = await prisma.$queryRawUnsafe(`select email, role, hotel_id from staff_users order by created_at`);
  console.log("RESULT >>> after clean:", JSON.stringify(c));
}
main().catch(e=>console.log("ERR",e.message)).finally(()=>prisma.$disconnect());