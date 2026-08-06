import "dotenv/config";
import { prisma } from "../db";
import { randomUUID } from "crypto";
async function main() {
  const id = randomUUID();
  await prisma.$executeRawUnsafe(
    `insert into "Request" (id, "hotelId", "roomNumber", "guestPhone", intent, department, "requestDetail", "ariaInterpretation", priority, status, notified, "isTest", "createdAt")
     values ($1, '1', '101', '+919876543210', 'room_service'::"RequestCategory", 'fb'::"Department", 'Chicken sandwich and a coffee to room 101', 'Guest wants in-room dining', 'normal'::"RequestPriority", 'received'::"RequestStatus", false, true, now())`,
    id);
  console.log("INSERTED test request:", id);
  const rows: any[] = await prisma.$queryRawUnsafe(`select id, department, status, "requestDetail" from "Request" where "hotelId"='1' and "isTest"=true order by "createdAt" desc limit 3`);
  console.log("TEST REQUESTS NOW:", JSON.stringify(rows));
}
main().catch(e=>console.log("ERR >>>",e.message)).finally(()=>prisma.$disconnect());