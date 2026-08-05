import "dotenv/config";
import { prisma } from "../db";
async function main() {
  // Hotel table NOT NULL columns
  const cols: any[] = await prisma.$queryRawUnsafe(`select ordinal_position, column_name, is_nullable, column_default from information_schema.columns where table_name='Hotel' order by ordinal_position`);
  console.log("RESULT >>> Hotel columns:");
  cols.forEach((c:any)=>console.log("  ", c.ordinal_position, c.column_name, "nullable="+c.is_nullable, c.column_default ? "default" : "NO-DEFAULT"));
}
main().catch(e=>console.log("ERR",e.message)).finally(()=>prisma.$disconnect());