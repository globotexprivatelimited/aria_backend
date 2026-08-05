import "dotenv/config";
import { prisma } from "../db";
async function main() {
  try { const c: any[] = await prisma.$queryRawUnsafe(`select column_name from information_schema.columns where table_name='rooms' order by ordinal_position`); console.log("RESULT >>> rooms table cols:", c.map((x:any)=>x.column_name).join(",") || "NO TABLE"); }
  catch(e){ console.log("RESULT >>> rooms table: MISSING -", (e as Error).message.slice(0,40)); }
  try { const n: any[] = await prisma.$queryRawUnsafe(`select count(*) n from rooms where hotel_id='1'`); console.log("RESULT >>> rooms for hotel 1:", n[0].n); } catch(e){ console.log("no rooms yet"); }
}
main().catch(e=>console.log("ERR",e.message)).finally(()=>prisma.$disconnect());