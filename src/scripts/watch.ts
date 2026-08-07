import "dotenv/config";
import { prisma } from "../db";
async function main() {
  const r: any[] = await prisma.$queryRawUnsafe(
    `select "roomNumber" room, department::text dept, status::text status, declined,
            "claimedBy", "claimedAt", "resolvedAt", "createdAt"
       from "Request" where "hotelId"='1' and "createdAt" > now() - interval '2 hours'
      order by "createdAt" desc limit 10`);
  if (!r.length) { console.log("(nothing in the last 2 hours)"); return; }
  console.log("RECENT REQUESTS");
  r.forEach((x:any)=>{
    const claimMs = x.claimedAt ? (new Date(x.claimedAt).getTime() - new Date(x.createdAt).getTime())/1000 : null;
    const doneMs = x.resolvedAt ? (new Date(x.resolvedAt).getTime() - new Date(x.createdAt).getTime())/1000 : null;
    console.log("  room " + x.room + " | " + x.dept + " | " + (x.declined ? "DECLINED" : x.status) +
      " | by: " + (x.claimedBy ?? "-") +
      " | claimed after: " + (claimMs != null ? claimMs.toFixed(0) + "s" : "-") +
      " | done after: " + (doneMs != null ? doneMs.toFixed(0) + "s" : "-"));
  });
  const waiting: any[] = await prisma.$queryRawUnsafe(
    `select department::text d, count(*)::int n from "Request"
      where "hotelId"='1' and status='received' group by department`);
  console.log("STILL RINGING:", waiting.length ? waiting.map((x:any)=>x.d + "=" + x.n).join(", ") : "nothing - alarm should be silent");
}
main().catch((e)=>console.log("ERR", e.message)).finally(()=>prisma.$disconnect());
