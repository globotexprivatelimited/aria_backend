import "dotenv/config";
import { prisma } from "../db";
async function main() {
  const cols: any[] = await prisma.$queryRawUnsafe(`
    select column_name, is_nullable, ordinal_position
    from information_schema.columns where table_name='staff_users' order by ordinal_position`);
  console.log("RESULT >>> staff_users columns (name/nullable/pos):");
  cols.forEach((c:any)=>console.log("  ", c.ordinal_position, c.column_name, c.is_nullable));
}
main().catch(e=>console.log("ERR",e.message)).finally(()=>prisma.$disconnect());