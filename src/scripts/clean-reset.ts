import "dotenv/config";
import { prisma } from "../db";
import { supabaseAdmin } from "../lib/supabaseAdmin";

async function main() {
  console.log("=== ARIA CLEAN RESET - wiping all test data ===\n");

  // 1. delete the Supabase Auth users for every staff_users row (GMs, staff, founder)
  const authRows = await prisma.$queryRawUnsafe<{ auth_user_id: string }[]>(
    `select auth_user_id from staff_users`
  );
  let deleted = 0;
  for (const r of authRows) {
    try { await supabaseAdmin.auth.admin.deleteUser(r.auth_user_id); deleted++; } catch { /* already gone */ }
  }
  console.log("auth logins deleted:", deleted, "of", authRows.length);

  // 2. wipe all app tables (order matters for any FKs; raw deletes so no FK blocks)
  const tables = [
    "staff_departments", "staff_users", "hotel_departments",
    "Request", "Message", "Session",
    "DiningBooking", "ActivityBooking", "ActivityWaitlist",
    "ProactiveTrigger", "ProcessedMessage",
    "GuestConsent", "ErasureRequest", "StaffContact", "Guest",
    "Hotel",
  ];
  for (const t of tables) {
    try {
      const n = await prisma.$executeRawUnsafe(`delete from "${t}"`);
      console.log("cleared", t, "->", n, "rows");
    } catch (e) {
      // table might be named lowercase or not exist - try lowercase
      try {
        const n2 = await prisma.$executeRawUnsafe(`delete from ${t.toLowerCase()}`);
        console.log("cleared", t.toLowerCase(), "->", n2, "rows");
      } catch {
        console.log("skip", t, "(", (e instanceof Error ? e.message : String(e)).slice(0, 50), ")");
      }
    }
  }

  // 3. reset the hotel counter so the next real hotel is #1
  await prisma.$executeRawUnsafe(`update id_counters set value = 0 where name = 'hotel'`);
  console.log("\nhotel counter reset to 0 - next hotel will be #1");
  console.log("\n=== CLEAN SLATE READY ===");
}
main().catch(console.error).finally(() => prisma.$disconnect());