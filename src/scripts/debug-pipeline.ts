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
  console.log("session:", session ? session.state + " room " + session.roomNumber : "NONE");
  if (!session) { console.log("no active session - checkin first"); return; }

  const text = "Can I get 2 towels and book a spa massage at 5pm";
  const { output, usedFallback } = await understand(text, hotel, session);
  console.log("fallback:", usedFallback, "| brain requests:", output.requests.length);
  for (const r of output.requests) console.log("   -", r.intent, "/", r.priority, "-", r.detail);

  const result = await executeRequests(output, hotel, session, session.guestPhone, "debug-" + Date.now());
  console.log("executor result:", JSON.stringify(result));

  const open = await prisma.request.count({ where: { hotelId: "demo", status: { in: ["received", "in_progress"] } } });
  console.log("open requests in DB now:", open);
}

main().catch((e) => console.error("THREW:", e)).finally(() => prisma.$disconnect());
