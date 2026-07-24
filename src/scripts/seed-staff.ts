import "dotenv/config";
import { prisma } from "../db";

const staff = [
  { department: "housekeeping", staffName: "Housekeeping Desk", whatsappNumber: "+919000000002" },
  { department: "fb", staffName: "Room Service", whatsappNumber: "+919000000003" },
  { department: "dining", staffName: "Restaurant", whatsappNumber: "+919000000004" },
  { department: "spa", staffName: "Spa Reception", whatsappNumber: "+919000000005" },
  { department: "maintenance", staffName: "Maintenance", whatsappNumber: "+919000000006" },
  { department: "activities", staffName: "Activities Desk", whatsappNumber: "+919000000007" },
  { department: "gm", staffName: "General Manager", whatsappNumber: "+919000000008" },
];

async function main() {
  for (const s of staff) {
    const existing = await prisma.staffContact.findFirst({
      where: { hotelId: "demo", whatsappNumber: s.whatsappNumber },
    });
    if (existing) { console.log("already there:", s.department); continue; }
    await prisma.staffContact.create({
      data: { hotelId: "demo", department: s.department as never, staffName: s.staffName, whatsappNumber: s.whatsappNumber },
    });
    console.log("seeded:", s.department, s.whatsappNumber);
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
