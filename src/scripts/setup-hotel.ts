import "dotenv/config";
import { prisma } from "../db";

// ---- EDIT THESE ----
const HOTEL_ID = "regent";                      // short slug, no spaces
const HOTEL_NAME = "The Regent, Kolkata";       // real hotel name
const WHATSAPP_NUMBER = "+919999999999";        // the hotel's real WhatsApp number
const TIMEZONE = "Asia/Kolkata";

const STAFF = [
  { department: "front_desk",   name: "Front Desk",   phone: "+919111111111" },
  { department: "housekeeping", name: "Housekeeping", phone: "+919222222222" },
  { department: "fb",           name: "Room Service", phone: "+919333333333" },
  { department: "dining",       name: "Restaurant",   phone: "+919444444444" },
  { department: "spa",          name: "Spa",          phone: "+919555555555" },
  { department: "maintenance",  name: "Maintenance",  phone: "+919666666666" },
  { department: "activities",   name: "Activities",   phone: "+919777777777" },
  { department: "gm",           name: "General Manager", phone: "+919888888888" },
];
// --------------------

async function main() {
  const hotel = await prisma.hotel.upsert({
    where: { hotelId: HOTEL_ID },
    update: { name: HOTEL_NAME, whatsappNumber: WHATSAPP_NUMBER, timezone: TIMEZONE, isActive: true },
    create: { hotelId: HOTEL_ID, name: HOTEL_NAME, whatsappNumber: WHATSAPP_NUMBER, timezone: TIMEZONE },
  });

  console.log("\nHotel ready:");
  console.log("  id:      " + hotel.hotelId);
  console.log("  name:    " + hotel.name);
  console.log("  number:  " + hotel.whatsappNumber);
  console.log("  WEBHOOK TOKEN: " + hotel.webhookToken);

  for (const s of STAFF) {
    const existing = await prisma.staffContact.findFirst({
      where: { hotelId: HOTEL_ID, whatsappNumber: s.phone },
    });
    if (existing) { console.log("  staff already set: " + s.department); continue; }
    await prisma.staffContact.create({
      data: { hotelId: HOTEL_ID, department: s.department as never, staffName: s.name, whatsappNumber: s.phone },
    });
    console.log("  staff added: " + s.department + " -> " + s.phone);
  }

  console.log("\nPoint the Wati webhook at:");
  console.log("  https://YOUR-PUBLIC-URL/webhooks/wati/" + hotel.webhookToken + "\n");
}

main().catch(console.error).finally(() => prisma.$disconnect());
