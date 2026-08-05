import "dotenv/config";
import { prisma } from "../db";
async function main() {
  // what tables exist?
  const tables: any[] = await prisma.$queryRawUnsafe(`select table_name from information_schema.tables where table_schema='public' order by table_name`);
  console.log("RESULT >>> tables:", tables.map((t:any)=>t.table_name).join(", "));

  // does orders table exist + have data?
  try {
    const orders: any[] = await prisma.$queryRawUnsafe(`select count(*) as n, coalesce(sum(total_amount),0) as revenue from orders`);
    console.log("RESULT >>> orders count:", orders[0].n, "total revenue:", orders[0].revenue);
  } catch (e) { console.log("RESULT >>> orders table:", (e instanceof Error ? e.message : String(e)).slice(0,60)); }

  // orders columns
  try {
    const cols: any[] = await prisma.$queryRawUnsafe(`select column_name from information_schema.columns where table_name='orders' order by ordinal_position`);
    console.log("RESULT >>> orders columns:", cols.map((c:any)=>c.column_name).join(", "));
  } catch (e) { console.log("no orders cols"); }

  // do time_slots have price?
  try {
    const sc: any[] = await prisma.$queryRawUnsafe(`select column_name from information_schema.columns where table_name='time_slots' order by ordinal_position`);
    console.log("RESULT >>> time_slots columns:", sc.map((c:any)=>c.column_name).join(", "));
  } catch (e) { console.log("no time_slots"); }
}
main().catch(e=>console.log("ERR",e.message)).finally(()=>prisma.$disconnect());