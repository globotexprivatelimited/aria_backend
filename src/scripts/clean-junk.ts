import "dotenv/config";
import { prisma } from "../db";
async function main() {
  await prisma.$executeRawUnsafe(`delete from staff_departments where staff_user_id='00000000-0000-0000-0000-000000000000'`);
  console.log("CLEANED junk test row");
}
main().catch(e=>console.log("ERR",e.message)).finally(()=>prisma.$disconnect());