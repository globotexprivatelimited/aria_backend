import "dotenv/config";
import { prisma } from "../db";
async function main() {
  const rows: any[] = await prisma.$queryRawUnsafe(
    `select tablename, rowsecurity from pg_tables where tablename = 'Hotel'`
  );
  console.log("Hotel RLS:", JSON.stringify(rows));
  const pol: any[] = await prisma.$queryRawUnsafe(
    `select policyname, cmd from pg_policies where tablename = 'Hotel'`
  );
  console.log("Hotel policies:", JSON.stringify(pol));
}
main().catch(console.error).finally(() => prisma.$disconnect());