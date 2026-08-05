import "dotenv/config";
import { prisma } from "../db";

const cols = [
  // item kind: food vs beverage vs alcohol (drinks!) - drives filtering + age-gating
  `alter table menu_items add column if not exists kind text not null default 'food'`,   // food | beverage | alcohol | dessert
  `alter table menu_items add column if not exists is_alcoholic boolean not null default false`,
  `alter table menu_items add column if not exists age_restricted boolean not null default false`,
  // dietary + allergen detail
  `alter table menu_items add column if not exists allergens text`,      // comma list: nuts, dairy, gluten, shellfish...
  `alter table menu_items add column if not exists is_jain boolean not null default false`,
  `alter table menu_items add column if not exists is_halal boolean not null default false`,
  `alter table menu_items add column if not exists gluten_free boolean not null default false`,
  // serving + nutrition
  `alter table menu_items add column if not exists serving_size text`,   // "250 ml", "2 pcs"
  `alter table menu_items add column if not exists calories integer`,
  `alter table menu_items add column if not exists portion text`,        // single | sharing
  // commerce
  `alter table menu_items add column if not exists tax_pct numeric(5,2) not null default 0`,
  `alter table menu_items add column if not exists is_signature boolean not null default false`,  // chef's special
  `alter table menu_items add column if not exists is_bestseller boolean not null default false`,
];
async function main() {
  for (const sql of cols) {
    try { await prisma.$executeRawUnsafe(sql); console.log("ok  :", sql.slice(0, 66)); }
    catch (e) { console.log("note:", (e instanceof Error ? e.message : String(e)).slice(0, 60)); }
  }
  console.log("\nfull menu detail columns ready.");
}
main().catch(console.error).finally(() => prisma.$disconnect());