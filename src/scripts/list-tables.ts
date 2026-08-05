import "dotenv/config";
import { prisma } from "../db";

async function main() {
  const rows = await prisma.$queryRawUnsafe<{ table_name: string }[]>(
    "select table_name from information_schema.tables where table_schema = 'public' order by table_name"
  );
  console.log("Postgres tables:");
  for (const r of rows) console.log("  " + r.table_name);
}

main().catch(console.error).finally(() => prisma.$disconnect());
