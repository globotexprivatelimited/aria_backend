import "dotenv/config";
import { prisma } from "../db";
async function main() {
  const rows: any[] = await prisma.$queryRawUnsafe(`
    select su.full_name, su.hotel_id, sd.dept
    from staff_users su
    join staff_departments sd on sd.staff_user_id = su.id
    order by su.created_at desc limit 10
  `);
  console.log("staff + their departments:", JSON.stringify(rows));
}
main().catch(console.error).finally(() => prisma.$disconnect());