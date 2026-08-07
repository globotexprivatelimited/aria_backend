import "dotenv/config";
import { prisma } from "../db";
import bcrypt from "bcryptjs";
import { randomUUID } from "crypto";

const GUESTS: [string, string, number, string][] = [
  ["Arundhati Sen", "+919830112244", 2, "deluxe"],
  ["Vikram Rathore", "+919820334455", 1, "standard"],
  ["Nisha D'Souza", "+919845667788", 2, "deluxe"],
  ["Joseph Kurien", "+919846778899", 4, "suite"],
  ["Rakesh Tomar", "+919755889900", 2, "standard"],
  ["Meera Iyer", "+919886001122", 1, "standard"],
  ["Aditya Bhatt", "+919879112233", 3, "deluxe"],
  ["Farah Sheikh", "+919821223344", 2, "suite"],
  ["Sanjay Bhargava", "+919755334455", 2, "standard"],
  ["Priya Menon", "+919847445566", 1, "deluxe"],
  ["Harpreet Kaur", "+919815556677", 2, "standard"],
  ["Debashis Rout", "+919437667788", 3, "deluxe"],
  ["Ananya Ghosh", "+919831778899", 2, "standard"],
  ["Imran Qureshi", "+919820889900", 1, "standard"],
  ["Kavya Reddy", "+919848990011", 2, "suite"],
];

const STAFF: [string, string, string, string[]][] = [
  ["Anil Kumar", "anil.kumar@royalpalace.in", "+919830445566", ["front_desk"]],
  ["Sunita Devi", "sunita.devi@royalpalace.in", "+919831556677", ["housekeeping"]],
  ["Ramesh Yadav", "ramesh.yadav@royalpalace.in", "+919832667788", ["maintenance"]],
  ["Deepa Nair", "deepa.nair@royalpalace.in", "+919833778899", ["spa", "fb"]],
  ["Suresh Pillai", "suresh.pillai@royalpalace.in", "+919834889900", ["fb", "dining"]],
];

const JOBS: [string, string, string][] = [
  ["room_service", "fb", "Two masala chai and a club sandwich"],
  ["room_service", "fb", "Butter chicken and naan for two"],
  ["housekeeping", "housekeeping", "Extra towels and pillows please"],
  ["housekeeping", "housekeeping", "Room cleaning after 3pm"],
  ["spa", "spa", "Couples massage this evening if possible"],
  ["spa", "spa", "Head massage for one at 6pm"],
  ["dining", "dining", "Table for four on the terrace at 8"],
  ["maintenance", "maintenance", "The air conditioner is rattling"],
  ["maintenance", "maintenance", "Bathroom tap is dripping"],
  ["concierge", "front_desk", "Can you arrange an airport drop at 6am"],
  ["room_service", "fb", "Fresh lime soda and a fruit plate"],
  ["housekeeping", "housekeeping", "One more blanket for tonight"],
];

const pick = <T,>(a: T[]) => a[Math.floor(Math.random() * a.length)];
const hoursAgo = (h: number) => new Date(Date.now() - h * 3600000);

async function main() {
  const H = "1";

  // ---- staff ----
  for (const [name, email, phone, depts] of STAFF) {
    const found = await prisma.$queryRawUnsafe<any[]>(`select id from staff_users where lower(email)=lower($1)`, email);
    let id = found[0]?.id;
    if (!id) {
      id = randomUUID();
      await prisma.$executeRawUnsafe(
        `insert into staff_users (id, auth_user_id, hotel_id, role, full_name, email, phone, password_hash, is_active)
         values ($1::uuid,$2::uuid,$3,'staff',$4,$5,$6,$7,true)`,
        id, randomUUID(), H, name, email, phone, await bcrypt.hash("aria12345", 10));
    }
    for (const d of depts) {
      await prisma.$executeRawUnsafe(
        `insert into staff_departments (staff_user_id, dept, active)
         select $1::uuid,$2,true where not exists (select 1 from staff_departments where staff_user_id=$1::uuid and dept=$2)`,
        id, d);
    }
  }
  console.log("staff ready:", STAFF.length);

  // ---- guests into rooms ----
  const free = await prisma.$queryRawUnsafe<any[]>(
    `select room_number from rooms where hotel_id=$1 and status='available' order by room_number limit 15`, H);
  let placed = 0;
  for (let i = 0; i < Math.min(GUESTS.length, free.length); i++) {
    const [name, phone, party] = GUESTS[i];
    const nights = 1 + Math.floor(Math.random() * 3);
    await prisma.$executeRawUnsafe(
      `update rooms set status='occupied', guest_name=$3, guest_phone=$4, party_size=$5,
              check_in = now() - ($6 || ' hours')::interval,
              check_out = now() + ($7 || ' days')::interval
        where hotel_id=$1 and room_number=$2`,
      H, free[i].room_number, name, phone, party, String(2 + i * 3), String(nights));
    placed += 1;
  }
  console.log("guests checked in:", placed);

  // ---- request history across the week ----
  const occupied = await prisma.$queryRawUnsafe<any[]>(
    `select room_number, guest_phone from rooms where hotel_id=$1 and status='occupied'`, H);
  const staffNames = STAFF.map((s) => s[0]).concat(["Rima Mahanty", "Sohail Khan"]);
  let made = 0;

  for (let i = 0; i < 40; i++) {
    const [intent, dept, detail] = pick(JOBS);
    const room = occupied.length ? pick(occupied) : null;
    const age = Math.random() * 120;               // spread over five days
    const created = hoursAgo(age);
    const settled = i % 7 !== 0;                    // most are done, some still open
    const declined = settled && i % 11 === 0;       // a few were turned away
    const who = pick(staffNames);
    const claimMins = 1 + Math.floor(Math.random() * 12);
    const doneMins = claimMins + 5 + Math.floor(Math.random() * 30);
    const revenue = dept === "fb" ? 250 + Math.floor(Math.random() * 900)
      : dept === "spa" ? 1200 + Math.floor(Math.random() * 2500)
      : dept === "dining" ? 800 + Math.floor(Math.random() * 2200) : 0;

    await prisma.$executeRawUnsafe(
      `insert into "Request"
         (id,"hotelId","roomNumber","guestPhone",intent,department,"requestDetail","ariaInterpretation",
          priority,status,declined,"claimedBy","claimedAt","resolvedAt","revenueGenerated",notified,"isTest","createdAt")
       values ($1,$2,$3,$4,$5::"RequestCategory",$6::"Department",$7,'Guest request via WhatsApp',
               $8::"RequestPriority",$9::"RequestStatus",$10,$11,$12,$13,$14,true,false,$15)`,
      randomUUID(), H, room?.room_number ?? null, room?.guest_phone ?? null, intent, dept, detail,
      i % 9 === 0 ? "urgent" : "normal",
      settled ? "resolved" : "received",
      declined,
      settled ? who : null,
      settled ? new Date(created.getTime() + claimMins * 60000) : null,
      settled ? new Date(created.getTime() + doneMins * 60000) : null,
      declined ? 0 : (settled ? revenue : 0),
      created);
    made += 1;
  }
  console.log("requests created:", made);

  const s: any[] = await prisma.$queryRawUnsafe(
    `select status::text st, count(*)::int n from "Request" where "hotelId"=$1 group by status`, H);
  s.forEach((x:any)=>console.log("  ", x.st, x.n));
  const occ: any[] = await prisma.$queryRawUnsafe(
    `select count(*) filter (where status='occupied')::int o, count(*)::int t from rooms where hotel_id=$1`, H);
  console.log("rooms:", occ[0].o + "/" + occ[0].t, "occupied");
  const rev: any[] = await prisma.$queryRawUnsafe(
    `select coalesce(sum("revenueGenerated"),0)::float v from "Request" where "hotelId"=$1`, H);
  console.log("revenue recorded:", Math.round(rev[0].v));
}
main().catch((e)=>console.log("ERR", e.message)).finally(()=>prisma.$disconnect());
