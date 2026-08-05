import "dotenv/config";
import { prisma } from "../db";
async function main() {
  const fn: any[] = await prisma.$queryRawUnsafe(`select proname from pg_proc where proname='decrement_stock'`);
  const t: any[] = await prisma.$queryRawUnsafe(`select table_name from information_schema.tables where table_name in ('orders','order_items')`);
  console.log("RESULT >>> decrement_stock fn:", fn.length > 0, "| tables:", JSON.stringify(t.map((x:any)=>x.table_name)));
}
main().catch(e=>console.log("ERR",e.message)).finally(()=>prisma.$disconnect());