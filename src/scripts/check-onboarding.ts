import "dotenv/config";
import { prisma } from "../db";
async function main() {
  const staff: any[] = await prisma.$queryRawUnsafe(`select role, hotel_id, full_name from staff_users order by created_at desc limit 5`);
  const hotel: any[] = await prisma.$queryRawUnsafe(`select "hotelId", name, city, room_count, onboarded from "Hotel" where "hotelId"='regent-kol'`);
  const depts: any[] = await prisma.$queryRawUnsafe(`select dept, staff_number from hotel_departments where hotel_id='regent-kol'`);
  console.log("STAFF:", JSON.stringify(staff));
  console.log("HOTEL:", JSON.stringify(hotel));
  console.log("DEPTS:", JSON.stringify(depts));
}
main().catch(console.error).finally(() => prisma.$disconnect());