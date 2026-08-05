import "dotenv/config";
import { prisma } from "../db";
async function main() {
  const s: any[] = await prisma.$queryRawUnsafe(`select column_name from information_schema.columns where table_name='Session' order by ordinal_position`);
  console.log("RESULT >>> Session cols:", s.map((c:any)=>c.column_name).join(","));
  const rt: any[] = await prisma.$queryRawUnsafe(`select table_name from information_schema.tables where table_schema='public' and table_name ilike '%room%'`);
  console.log("RESULT >>> existing room tables:", rt.map((t:any)=>t.table_name).join(",") || "NONE");
  // check-in/out endpoints - do they write to Session?
  console.log("RESULT >>> check done");
}
main().catch(e=>console.log("ERR",e.message)).finally(()=>prisma.$disconnect());