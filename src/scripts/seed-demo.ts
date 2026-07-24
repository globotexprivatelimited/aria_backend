import { prisma } from "../db";

async function main() {
  const hotel = await prisma.hotel.upsert({
    where: { hotelId: "demo" },
    update: {},
    create: {
      hotelId: "demo",
      name: "The Regent, Kolkata",
      whatsappNumber: "+910000000000",
      webhookToken: "demo-token-123",
      timezone: "Asia/Kolkata",
    },
  });
  console.log("Seeded hotel:", hotel.hotelId, "| webhook token:", hotel.webhookToken);

  const staffPhone = "+919000000001";
  const existing = await prisma.staffContact.findFirst({
    where: { hotelId: "demo", whatsappNumber: staffPhone },
  });
  if (!existing) {
    await prisma.staffContact.create({
      data: { hotelId: "demo", staffName: "Front Desk", whatsappNumber: staffPhone, department: "front_desk" },
    });
    console.log("Seeded staff contact:", staffPhone, "(front_desk)");
  } else {
    console.log("Staff contact already present:", staffPhone);
  }
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
