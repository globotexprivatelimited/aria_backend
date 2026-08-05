import "dotenv/config";
import { prisma } from "../db";
async function main() {
  // clean any test rows
  await prisma.$executeRawUnsafe(`delete from staff_departments where staff_user_id in (select id from staff_users where hotel_id not in ('1'))`);
  await prisma.$executeRawUnsafe(`delete from staff_users where hotel_id not in ('1') or hotel_id = ''`);
  await prisma.$executeRawUnsafe(`delete from "Hotel" where "hotelId" not in ('1')`);
  const c: any[] = await prisma.$queryRawUnsafe(`select email, role, hotel_id from staff_users order by created_at`);
  console.log("RESULT >>> remaining staff:", JSON.stringify(c));
}
main().catch(e=>console.log("ERR",e.message)).finally(()=>prisma.$disconnect());