import "dotenv/config";
import { prisma } from "../db";
async function main() {
  await prisma.$executeRawUnsafe(`alter table menu_items add column if not exists available boolean not null default true`);
  const cols: any[] = await prisma.$queryRawUnsafe(`select column_name from information_schema.columns where table_name='menu_items' and column_name='available'`);
  console.log("RESULT >>> menu_items.available exists:", cols.length > 0);
}
main().catch(e=>console.log("ERR",e.message)).finally(()=>prisma.$disconnect());