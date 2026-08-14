import "dotenv/config";
import { checkInGuest } from "../lib/frontdesk";
import { prisma } from "../db";

async function main() {
  const H = "16";
  const phone = "+918597495156";
  const name = "Mahasin Khan";

  const s = await checkInGuest(H, "101", name, phone, new Date(Date.now() + 2 * 86400000));
  console.log("session:", s?.id ?? "created");

  const r: any[] = await prisma.$queryRawUnsafe(
    `select "guestPhone", "roomNumber", state::text, "roomVerified" from "Session" where "hotelId"=$1`, H);
  r.forEach((x:any)=>console.log("  ", x.guestPhone, "room", x.roomNumber, "|", x.state, "| verified:", x.roomVerified));
}
main().catch((e)=>console.log("ERR", e.message)).finally(()=>prisma.$disconnect());
