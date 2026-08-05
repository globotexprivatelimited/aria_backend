import "dotenv/config";
import { prisma } from "../db";
async function main() {
  const cols: any[] = await prisma.$queryRawUnsafe(`select column_name from information_schema.columns where table_name = 'staff_users' order by ordinal_position`);
  const hasEmail = cols.some((c:any)=>c.column_name==='email');
  const hasPw = cols.some((c:any)=>c.column_name==='password_hash');
  console.log("");
  console.log("RESULT >>> hasEmail:", hasEmail, "| hasPasswordHash:", hasPw);
  console.log("RESULT >>> all columns:", cols.map((c:any)=>c.column_name).join(", "));
}
main().catch(e=>console.log("ERR >>>",e.message)).finally(()=>prisma.$disconnect());