import "dotenv/config";
import { prisma } from "../db";
async function main() {
  const s: any[] = await prisma.$queryRawUnsafe(`select column_name from information_schema.columns where table_name='Session' order by ordinal_position`);
  console.log("RESULT >>> Session cols:", s.map((c:any)=>c.column_name).join(","));
  const sc: any[] = await prisma.$queryRawUnsafe(`select count(*) n from "Session"`);
  console.log("RESULT >>> Session rows:", sc[0].n);
  // any table with 'room' in the name?
  const rt: any[] = await prisma.$queryRawUnsafe(`select table_name from information_schema.tables where table_schema='public' and table_name ilike '%room%'`);
  console.log("RESULT >>> room tables:", rt.map((t:any)=>t.table_name).join(",") || "NONE");
  // does Session have room + checkout?
  const has = s.map((c:any)=>c.column_name);
  console.log("RESULT >>> Session has roomNumber:", has.includes("roomNumber"), "checkOut:", has.some((x:string)=>x.toLowerCase().includes("checkout")||x.toLowerCase().includes("check_out")));
}
main().catch(e=>console.log("ERR",e.message)).finally(()=>prisma.$disconnect());