import "dotenv/config";
import { prisma } from "../db";

async function main() {
  // a tiny counter table that atomically hands out the next hotel number
  await prisma.$executeRawUnsafe(`
    create table if not exists id_counters (
      name text primary key,
      value bigint not null default 0
    )
  `);
  // seed the hotel counter if missing, starting so the FIRST allocated id is 1
  await prisma.$executeRawUnsafe(`
    insert into id_counters (name, value) values ('hotel', 0)
    on conflict (name) do nothing
  `);
  // show current
  const rows: any[] = await prisma.$queryRawUnsafe(`select name, value from id_counters where name='hotel'`);
  console.log("hotel counter:", JSON.stringify(rows));
  console.log("id_counters ready.");
}
main().catch(console.error).finally(() => prisma.$disconnect());