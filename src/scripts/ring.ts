import "dotenv/config";
import { prisma } from "../db";
import { randomUUID } from "crypto";

/**
 * Ring a department so you can hear the staff alarm.
 *   npx tsx src/scripts/ring.ts              -> in-room dining
 *   npx tsx src/scripts/ring.ts spa
 *   npx tsx src/scripts/ring.ts housekeeping urgent
 */
const JOBS: Record<string, { intent: string; dept: string; detail: string }> = {
  fb:           { intent: "room_service",  dept: "fb",           detail: "Club sandwich and a masala chai" },
  housekeeping: { intent: "housekeeping",  dept: "housekeeping", detail: "Extra towels and a bath robe" },
  spa:          { intent: "spa",           dept: "spa",          detail: "Deep tissue massage for two at 7pm" },
  dining:       { intent: "dining",        dept: "dining",       detail: "Table for four on the terrace tonight" },
  maintenance:  { intent: "maintenance",   dept: "maintenance",  detail: "Air conditioner is rattling badly" },
  front_desk:   { intent: "concierge",     dept: "front_desk",   detail: "Late checkout until 2pm please" },
};

async function main() {
  const key = (process.argv[2] ?? "fb").toLowerCase();
  const priority = (process.argv[3] ?? "normal").toLowerCase();
  const job = JOBS[key];
  if (!job) { console.log("Pick one of:", Object.keys(JOBS).join(", ")); return; }

  const room = String(100 + Math.floor(Math.random() * 15));
  await prisma.$executeRawUnsafe(
    `insert into "Request"
       (id,"hotelId","roomNumber","guestPhone",intent,department,"requestDetail","ariaInterpretation",
        priority,status,notified,"isTest","createdAt")
     values ($1,'1',$2,'+919876543210',$3::"RequestCategory",$4::"Department",$5,'Test request',
             $6::"RequestPriority",'received',false,true, now())`,
    randomUUID(), room, job.intent, job.dept, job.detail + " to room " + room, priority);

  console.log("RINGING " + job.dept.toUpperCase() + " | room " + room + " | " + priority);
  console.log("  " + job.detail);
  const open: any[] = await prisma.$queryRawUnsafe(
    `select department::text d, count(*)::int n from "Request"
      where "hotelId"='1' and status='received' group by department order by d`);
  console.log("waiting now:", open.length ? open.map((x:any)=>x.d + "=" + x.n).join(", ") : "none");
}
main().catch((e)=>console.log("ERR", e.message)).finally(()=>prisma.$disconnect());
