import "dotenv/config";
import { readFileSync } from "fs";
import { listFacts, addFact, deleteFact } from "../knowledge/service";

/**
 * The hotel's knowledge base from the command line:
 *   pnpm exec tsx src/scripts/knowledge.ts 16 list
 *   pnpm exec tsx src/scripts/knowledge.ts 16 add "Wi-Fi" "Network SunandaGuest, password at reception" essentials "wifi internet password"
 *   pnpm exec tsx src/scripts/knowledge.ts 16 remove "Wi-Fi"
 *   pnpm exec tsx src/scripts/knowledge.ts 16 import facts.txt     (one fact per line:  Topic :: Content :: category :: keywords)
 */
async function main() {
  const [hotelId, cmd, ...rest] = process.argv.slice(2);
  if (!hotelId || !cmd) { console.log("usage: knowledge.ts HOTEL_ID list | add TOPIC CONTENT [CATEGORY] [KEYWORDS] | remove TOPIC | import FILE"); return; }
  if (cmd === "list") {
    const facts = await listFacts(hotelId, true);
    if (!facts.length) console.log("no facts written for hotel " + hotelId + " yet");
    for (const f of facts) console.log((f.active ? "  " : "x ") + "[" + f.category + "] " + f.topic + ": " + f.content + (f.keywords ? "   (" + f.keywords + ")" : ""));
    return;
  }
  if (cmd === "add") {
    const f = await addFact(hotelId, rest[0] ?? "", rest[1] ?? "", rest[2] ?? "general", rest[3] ?? "");
    console.log(f ? "added: " + f.topic : "not added - need a topic and content");
    return;
  }
  if (cmd === "remove") {
    const facts = await listFacts(hotelId, true);
    const hit = facts.find((f) => f.topic.toLowerCase() === (rest[0] ?? "").toLowerCase());
    console.log(hit && (await deleteFact(hotelId, hit.id)) ? "removed: " + hit.topic : "no fact with that topic");
    return;
  }
  if (cmd === "import") {
    const lines = readFileSync(rest[0] ?? "", "utf8").split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));
    let n = 0;
    for (const line of lines) {
      const [topic, content, category, keywords] = line.split("::").map((s) => s.trim());
      if (await addFact(hotelId, topic ?? "", content ?? "", category || "general", keywords || "")) n++;
    }
    console.log("imported " + n + " of " + lines.length + " line(s) for hotel " + hotelId);
    return;
  }
  console.log("unknown command " + cmd);
}

main().catch((e) => console.log("ERR", e instanceof Error ? e.message : String(e))).finally(() => process.exit(0));
