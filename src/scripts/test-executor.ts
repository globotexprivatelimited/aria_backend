import "dotenv/config";
import { prisma } from "../db";
import { understand, isBrainEnabled } from "../brain";
import { executeRequests } from "../executor";

async function main() {
  console.log("brain enabled:", isBrainEnabled());

  const hotel = await prisma.hotel.findUnique({ where: { hotelId: "demo" } });
  if (!hotel) { console.log("no demo hotel"); return; }

  const session = await prisma.session.findFirst({
    where: { hotelId: "demo", guestPhone: "+919777111222", state: "active" },
    orderBy: { createdAt: "desc" },
  });
  if (!session) { console.log("no active session - run the checkin first"); return; }

  const text = "Hi! Can I get 2 fresh towels, a table for two tonight at 8, and the aircon is broken";
  console.log("\nGUEST:", text);

  const { output, usedFallback } = await understand(text, hotel, session);
  console.log("fallback used:", usedFallback);
  console.log("brain returned", output.requests.length, "request(s)");

  const result = await executeRequests(output, hotel, session, session.guestPhone, "direct-test-" + Date.now());
  console.log("\nEXECUTOR:", result);

  const rows = await prisma.request.findMany({
    where: { hotelId: "demo" },
    orderBy: { createdAt: "desc" },
    take: 5,
  });
  console.log("\nRequests now in the database:");
  for (const r of rows) {
    console.log("  [" + r.department + "/" + r.priority + "] room " + r.roomNumber + " - " + r.requestDetail);
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
