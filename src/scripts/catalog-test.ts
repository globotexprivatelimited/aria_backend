import "dotenv/config";
import { prisma } from "../db";
import { loadCatalog, applyCatalog } from "../menu/catalog";
import { understand } from "../brain";
import { loadDeptModes } from "../deptconfig/service";

/**
 * Dry run of the whole menu path for one message, against the real database and the real model,
 * without sending WhatsApp, placing an order, touching stock or logging missed demand.
 *   pnpm exec tsx src/scripts/catalog-test.ts 16 "2 mutton tikka and a chai please"
 */
const hotelId = process.argv[2] ?? "16";
const text = process.argv.slice(3).join(" ") || "2 mutton tikka and a chai please";

async function main() {
  const hotel = await prisma.hotel.findUnique({ where: { hotelId } });
  if (!hotel) throw new Error("no hotel with hotelId " + hotelId);
  const timezone = ((hotel as unknown as { timezone?: string | null }).timezone) ?? null;
  const catalog = await loadCatalog(hotelId, timezone);
  console.log("--- MENU AS ARIA SEES IT ---\n" + (catalog.promptText || "(no menu items yet - add some on the Departments page)") + "\n");
  const deptModes = Object.fromEntries(await loadDeptModes(hotelId));
  const { output, usedFallback } = await understand(
    text,
    { name: hotel.name, timezone, deptModes, catalogText: catalog.promptText },
    { roomNumber: "104", claimedGuestName: "Test Guest", roomVerified: true }
  );
  console.log("--- BRAIN OUTPUT" + (usedFallback ? " (FALLBACK - check ANTHROPIC_API_KEY)" : "") + " ---\n" + JSON.stringify(output, null, 2) + "\n");
  const final = await applyCatalog(output, catalog, hotelId, { roomNumber: "104" }, "+910000000000", { dryRun: true });
  console.log("--- REPLY THE GUEST WOULD RECEIVE ---\n" + final.reply + "\n");
  console.log("--- REQUESTS THAT WOULD BE FILED ---\n" + JSON.stringify(final.requests, null, 2));
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
