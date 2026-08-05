import "dotenv/config";
import { prisma } from "../db";
async function main() {
  const rows: any[] = await prisma.$queryRawUnsafe(
    `select column_name, is_nullable, column_default
     from information_schema.columns
     where table_name = 'Hotel'
     order by ordinal_position`
  );
  for (const r of rows) {
    const req = r.is_nullable === "NO" && !r.column_default ? "  <-- REQUIRED, no default" : "";
    console.log(r.column_name, "|", r.is_nullable, "|", r.column_default ?? "(none)", req);
  }
}
main().catch(console.error).finally(() => prisma.$disconnect());