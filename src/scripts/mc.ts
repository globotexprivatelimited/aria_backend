import "dotenv/config";
import { prisma } from "../db";
async function main() {
  const cols: any[] = await prisma.$queryRawUnsafe(`select column_name from information_schema.columns where table_name='menu_items' order by ordinal_position`);
  console.log("RESULT >>> menu_items cols:", cols.map((c:any)=>c.column_name).join(","));
  const has = cols.map((c:any)=>c.column_name);
  console.log("RESULT >>> has available:", has.includes("available"), "| has stock:", has.includes("stock"));
}
main().catch(e=>console.log("ERR",e.message)).finally(()=>prisma.$disconnect());