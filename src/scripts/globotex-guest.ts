import "dotenv/config";
import { prisma } from "../db";
import { randomUUID } from "crypto";

async function main() {
  const H = "16";
  const guestPhone = process.argv[2];
  const guestName = process.argv[3] ?? "Mahasin Khan";
  if (!guestPhone) {
    console.log("Usage: npx tsx src/scripts/globotex-guest.ts 918597495156 \"Your Name\"");
    return;
  }

  // a handful of rooms
  for (let i = 101; i <= 110; i++) {
    await prisma.$executeRawUnsafe(
      `insert into rooms (id, hotel_id, room_number, room_type, floor, status)
       select $1::uuid, $2, $3, 'deluxe', 1, 'available'
        where not exists (select 1 from rooms where hotel_id=$2 and room_number=$3)`,
      randomUUID(), H, String(i));
  }

  // check the guest into 101
  const phone = guestPhone.startsWith("+") ? guestPhone : "+" + guestPhone;
  await prisma.$executeRawUnsafe(
    `update rooms set status='occupied', guest_name=$3, guest_phone=$4, party_size=1,
            check_in=now(), check_out=now() + interval '2 days'
      where hotel_id=$1 and room_number=$2`, H, "101", guestName, phone);

  // and an active session so Aria knows who is messaging
  await prisma.$executeRawUnsafe(
    `delete from "Session" where "hotelId"=$1 and "guestPhone"=$2`, H, phone);
  await prisma.$executeRawUnsafe(
    `insert into "Session" (id, "hotelId", "guestPhone", "roomNumber", "guestName", state,
       "roomVerified", "claimedGuestName", "verificationMethod", "checkInDate", "checkOutDate",
       "consentGiven", "lastMessageAt", "conversationHistory", "pendingFollowUps")
     values ($1::uuid,$2,$3,'101',$4,'active'::"SessionState",true,$4,'front_desk_match'::"VerificationMethod",
       current_date, current_date + 2, true, now(), '[]'::jsonb, '[]'::jsonb)`,
    randomUUID(), H, phone, guestName);

  const r: any[] = await prisma.$queryRawUnsafe(
    `select room_number, guest_name, guest_phone from rooms where hotel_id=$1 and status='occupied'`, H);
  console.log("Globotex rooms created: 101-110");
  r.forEach((x:any)=>console.log("  room", x.room_number, "->", x.guest_name, x.guest_phone));
  console.log("Session ready. Message the hotel number from that phone.");
}
main().catch((e)=>console.log("ERR", e.message)).finally(()=>prisma.$disconnect());
