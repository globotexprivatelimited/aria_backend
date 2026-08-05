import "dotenv/config";
import { prisma } from "../db";

async function main() {
  try {
    await prisma.$executeRawUnsafe('alter publication supabase_realtime add table "Request"');
    console.log("Realtime enabled for the Request table.");
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("already") || msg.includes("is already a member")) {
      console.log("Already enabled - nothing to do.");
    } else {
      console.error("Failed:", msg);
    }
  }
}

main().finally(() => prisma.$disconnect());
