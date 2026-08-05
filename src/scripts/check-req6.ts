import "dotenv/config";
import { prisma } from "../db";
async function main() {
  const rows: any[] = await prisma.$queryRawUnsafe(
    `select "roomNumber", department, status, "requestDetail" from "Request" where "hotelId"='6' order by "createdAt" desc limit 5`
  );
  console.log("hotel 6 requests:", JSON.stringify(rows));
  console.log("brain key present:", Boolean(process.env.ANTHROPIC_API_KEY));
}
main().catch(console.error).finally(() => prisma.$disconnect());