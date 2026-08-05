import "dotenv/config";
import { prisma } from "../db";

const cols = [
  `alter table menu_items add column if not exists image_url text`,
  `alter table menu_items add column if not exists diet text`,            // veg | non_veg | vegan | egg
  `alter table menu_items add column if not exists spice text`,           // none | mild | medium | hot
  `alter table menu_items add column if not exists prep_mins integer not null default 0`,
  `alter table menu_items add column if not exists available_from text`,  // "07:00" window start (optional)
  `alter table menu_items add column if not exists available_to text`,    // "11:00" window end (optional)
  `alter table menu_items add column if not exists low_stock_at integer not null default 3`, // alert threshold
  `alter table menu_items add column if not exists description text`,
];
async function main() {
  for (const sql of cols) {
    try { await prisma.$executeRawUnsafe(sql); console.log("ok  :", sql.slice(0, 62)); }
    catch (e) { console.log("note:", (e instanceof Error ? e.message : String(e)).slice(0, 60)); }
  }
  console.log("\nmenu depth columns ready.");
}
main().catch(console.error).finally(() => prisma.$disconnect());