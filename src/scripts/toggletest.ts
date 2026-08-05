import "dotenv/config";
import { prisma } from "../db";
import { setStaffDeptAccess } from "../staffaccess/service";
import * as fs from "fs";
async function main() {
  // get a real staff id
  const su: any[] = await prisma.$queryRawUnsafe(`select id from staff_users limit 1`);
  const staffId = su[0]?.id;
  let out = "staffId used: " + staffId + "\n";
  // call exactly what the toggle calls
  const r = await setStaffDeptAccess("1", staffId, "fb", false);
  out += "RESULT: " + JSON.stringify(r) + "\n";
  // try toggling it back
  const r2 = await setStaffDeptAccess("1", staffId, "fb", true);
  out += "RESULT2: " + JSON.stringify(r2) + "\n";
  fs.writeFileSync("C:\\Projects\\aria\\toggletest.txt", out);
  console.log(out);
}
main().catch(e=>{ require("fs").writeFileSync("C:\\Projects\\aria\\toggletest.txt", "CRASH: " + e.message); console.log("ERR", e.message); }).finally(()=>prisma.$disconnect());