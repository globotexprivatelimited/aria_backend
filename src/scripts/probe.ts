import "dotenv/config";
import { prisma } from "../db";
import * as fs from "fs";
async function main() {
  const cols: any[] = await prisma.$queryRawUnsafe(`select column_name from information_schema.columns where table_name='staff_departments' order by ordinal_position`);
  const names = cols.map((c:any)=>c.column_name).join("_");
  fs.mkdirSync("C:\\Projects\\aria\\PROBE", { recursive: true });
  // write the column names AS a filename so you can see it in the folder
  fs.writeFileSync("C:\\Projects\\aria\\PROBE\\COLS__" + names + ".txt", "here");
}
main().catch(e=>{ try { require("fs").writeFileSync("C:\\Projects\\aria\\PROBE\\ERROR.txt", e.message); } catch {} }).finally(()=>prisma.$disconnect());