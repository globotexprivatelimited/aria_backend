import "dotenv/config";
import { prisma } from "../db";
import { attachWeather, loadCatalog, applyCatalog, loadGuestContext, describePending, fastPath, suggestionsForPrompt, loadGuestHistory } from "../menu/catalog";
import { understand, type BrainTurn } from "../brain";
import { polishReply } from "../brain/polish";
import { runAgent, useAgent } from "../agent";
import type { DoneAction } from "../agent/tools";
import { isTrivialMessage, trivialReply } from "../webhooks/inbound";
import { loadDeptModes } from "../deptconfig/service";
import { localWeather, weatherForPrompt } from "../lib/weather";

/**
 * A whole conversation through the real brain and catalogue, turn by turn, with Aria's memory carried
 * between messages - but nothing is sent, ordered or booked. Messages are separated by a bar:
 *   pnpm exec tsx src/scripts/converse.ts 16 "hi|beverage menu|2 samosa"
 */
const TEST_PHONE = "+910000000099";

async function main() {
  const hotelId = process.argv[2] ?? "16";
  const script = (process.argv[3] ?? "hi|what is good for lunch?|beverage menu|pls snd 2 samosa|facial tomorrow morning, male therapist please|10 am|tv not working").split("|").map((s) => s.trim()).filter(Boolean);
  const hotel: any = await prisma.hotel.findUnique({ where: { hotelId } });
  if (!hotel) { console.log("no hotel " + hotelId); return; }
  const deptModes = Object.fromEntries(await loadDeptModes(hotelId));
  const catalog = await loadCatalog(hotelId, hotel.timezone ?? null);
  const session = { roomNumber: "104", claimedGuestName: "Test Guest", roomVerified: true };
  const turns: BrainTurn[] = [];
  const done: DoneAction[] = [];
  const clear = async () => { try { await prisma.$executeRawUnsafe("delete from guest_context where hotel_id = $1 and guest_phone = $2", hotelId, TEST_PHONE); } catch { /* table not created yet */ } };
  await clear();
  const history = await loadGuestHistory(hotelId, TEST_PHONE);
  const weather = await localWeather(hotelId);
  attachWeather(catalog, weather);
  console.log("WEATHER -> " + weatherForPrompt(weather));
  for (const message of script) {
    const t = Date.now();
    const pending = await loadGuestContext(hotelId, TEST_PHONE);
    if (useAgent()) {
      if (isTrivialMessage(message)) { console.log("\nGUEST: " + message); console.log("ARIA (no model - trivial message, as in production):"); console.log("   " + trivialReply(message)); turns.push({ role: "user", content: message }, { role: "assistant", content: trivialReply(message) }); continue; }
      const agent = await runAgent(message, hotel, session, catalog, { deptModes, contextText: suggestionsForPrompt(catalog, history) + "\n" + weatherForPrompt(weather), history: turns, guestPhone: TEST_PHONE, dryRun: true, doneAlready: done });
      console.log("\nGUEST: " + message);
      console.log("ARIA (agent, " + agent.steps + " step" + (agent.steps === 1 ? "" : "s") + ", " + (Date.now() - t) + " ms):");
      console.log(agent.output.reply.split("\n").map((l) => "   " + l).join("\n"));
      for (const r of agent.output.requests) { console.log("   -> FILED " + r.intent + ": " + r.detail); done.unshift({ intent: r.intent, detail: r.detail, minutesAgo: 0, status: "received" }); }
      turns.push({ role: "user", content: message }, { role: "assistant", content: agent.output.reply });
      continue;
    }
    const fast = fastPath(message, pending, catalog);
    const brain = fast ? { output: fast, usedFallback: false } : await understand(message, { ...hotel, deptModes, catalogText: catalog.promptText, pendingText: describePending(pending), contextText: suggestionsForPrompt(catalog, history) + "\n" + weatherForPrompt(weather) }, session, { history: turns });
    const output = await applyCatalog(brain.output, catalog, hotelId, session, TEST_PHONE, { pending, message, deptModes, dryRun: true, persistContext: true });
    const shown = output.reply.replace(/[*#\s]/g, "") !== brain.output.reply.replace(/[*#\s]/g, "") ? await polishReply(output.reply, message) : output.reply;
    console.log("\nGUEST: " + message);
    console.log("ARIA (" + (fast ? "fast path" : "model") + ", " + (Date.now() - t) + " ms):");
    console.log(shown.split("\n").map((l) => "   " + l).join("\n"));
    for (const r of output.requests) console.log("   -> FILED " + r.intent + ": " + r.detail);
    turns.push({ role: "user", content: message }, { role: "assistant", content: shown });
  }
  await clear();
}

main().catch((e) => console.log("ERR", e instanceof Error ? e.message : String(e))).finally(() => process.exit(0));
