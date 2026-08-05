import "dotenv/config";
import { prisma } from "../db";
import * as fs from "fs";
async function main() {
  let out = "";
  try {
    const cols: any[] = await prisma.$queryRawUnsafe(`select column_name, data_type from information_schema.columns where table_name='staff_departments' order by ordinal_position`);
    out += "COLS: " + cols.map((c:any)=>c.column_name).join(",") + "\n";
    const has = cols.map((c:any)=>c.column_name);
    out += "HAS_ACTIVE: " + has.includes("active") + "\n";
    const rows: any[] = await prisma.$queryRawUnsafe(`select * from staff_departments limit 3`);
    out += "SAMPLE: " + JSON.stringify(rows) + "\n";
  } catch(e) { out += "ERR: " + (e as Error).message + "\n"; }
  // also check staff_users structure for the join
  try {
    const su: any[] = await prisma.$queryRawUnsafe(`select column_name from information_schema.columns where table_name='staff_users' order by ordinal_position`);
    out += "STAFF_USERS_COLS: " + su.map((c:any)=>c.column_name).join(",") + "\n";
  } catch(e) { out += "SU_ERR\n"; }
  fs.writeFileSync("C:\\Projects\\aria\\staffstruct.txt", out);
  console.log(out);
}
main().catch(e=>console.log("ERR",e.message)).finally(()=>prisma.$disconnect());