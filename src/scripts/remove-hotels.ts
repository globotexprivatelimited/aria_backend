import "dotenv/config";
import { prisma } from "../db";

/** Usage: npx tsx src/scripts/remove-hotels.ts 5 6 7 11 */
async function main() {
  const ids = process.argv.slice(2);
  if (!ids.length) { console.log("Pass the hotel ids to remove, e.g. 5 6 7 11"); return; }

  for (const H of ids) {
    const h: any[] = await prisma.$queryRawUnsafe(`select name from "Hotel" where "hotelId"=$1`, H);
    if (!h[0]) { console.log("hotel " + H + ": not found"); continue; }

    const staff: any[] = await prisma.$queryRawUnsafe(`select id from staff_users where hotel_id=$1`, H);
    for (const s of staff) {
      await prisma.$executeRawUnsafe(`delete from staff_departments where staff_user_id=$1::uuid`, s.id);
    }
    try { await prisma.$executeRawUnsafe(`delete from password_reset_tokens where staff_user_id in (select id from staff_users where hotel_id=$1)`, H); } catch {}
    await prisma.$executeRawUnsafe(`delete from staff_users where hotel_id=$1`, H);

    for (const t of ["rooms","dept_items","hotel_departments","time_slots","dept_config",
                     "onboarding_progress","stations","missed_demand","slot_bookings","email_verification_tokens"]) {
      try { await prisma.$executeRawUnsafe(`delete from ${t} where hotel_id=$1`, H); } catch {}
    }
    try { await prisma.$executeRawUnsafe(`delete from ticket_replies where ticket_id in (select id from support_tickets where hotel_id=$1)`, H); } catch {}
    try { await prisma.$executeRawUnsafe(`delete from support_tickets where hotel_id=$1`, H); } catch {}
    try { await prisma.$executeRawUnsafe(`delete from incidents where hotel_id=$1`, H); } catch {}

    await prisma.$executeRawUnsafe(`delete from "Request" where "hotelId"=$1`, H);
    await prisma.$executeRawUnsafe(`delete from "Session" where "hotelId"=$1`, H);
    await prisma.$executeRawUnsafe(`delete from "Hotel" where "hotelId"=$1`, H);
    console.log("removed hotel " + H + ": " + h[0].name);
  }

  const left: any[] = await prisma.$queryRawUnsafe(`select "hotelId" id, name from "Hotel" order by "createdAt"`);
  console.log("REMAINING:");
  left.forEach((x:any)=>console.log("  ", x.id, x.name));
}
main().catch((e)=>console.log("ERR", e.message)).finally(()=>prisma.$disconnect());
