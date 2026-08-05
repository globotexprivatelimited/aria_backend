import "dotenv/config";
import { prisma } from "../db";
async function main() {
  // remove the test registration's staff row + hotel so we can test cleanly
  await prisma.$executeRawUnsafe(`delete from staff_departments where staff_user_id in (select id from staff_users where lower(email)=lower('testowner@newhotel.com'))`);
  await prisma.$executeRawUnsafe(`delete from staff_users where lower(email)=lower('testowner@newhotel.com')`);
  await prisma.$executeRawUnsafe(`delete from "Hotel" where name = 'Test Hotel Migration'`);
  console.log("RESULT >>> test data cleaned");
  const still: any[] = await prisma.$queryRawUnsafe(`select email from staff_users where lower(email)=lower('testowner@newhotel.com')`);
  console.log("RESULT >>> testowner still exists:", still.length > 0);
}
main().catch(e=>console.log("ERR",e.message)).finally(()=>prisma.$disconnect());