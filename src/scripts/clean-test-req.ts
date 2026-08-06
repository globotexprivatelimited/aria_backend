import "dotenv/config";
import { prisma } from "../db";
async function main() {
  const n = await prisma.$executeRawUnsafe(`delete from "Request" where "isTest" = true`);
  console.log("removed test requests:", n);
  const left: any[] = await prisma.$queryRawUnsafe(`select count(*) c from "Request" where "isTest" = true`);
  console.log("test requests remaining:", left[0].c);
}
main().catch(e=>console.log("ERR",e.message)).finally(()=>prisma.$disconnect());
