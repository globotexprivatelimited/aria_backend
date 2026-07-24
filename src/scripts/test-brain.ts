import "dotenv/config";
import { understand, isBrainEnabled } from "../brain";

const hotel = { name: "The Regent, Kolkata", timezone: "Asia/Kolkata" };
const session = { roomNumber: "412", claimedGuestName: "Mahasin Khan", roomVerified: true };

const cases = [
  "Can I get two towels and a late checkout?",
  "Hi! Can I get 2 fresh towels, a table for two tonight at 8, and is there a spa?",
  "The aircon in my room is not working at all and it is really hot",
  "Thank you so much, that was lovely",
  "This is the third time I have asked and nobody has come. Very disappointed.",
];

async function main() {
  if (!isBrainEnabled()) {
    console.log("ANTHROPIC_API_KEY is not set - add it to .env first.");
    return;
  }
  for (const text of cases) {
    console.log("\n----------------------------------------");
    console.log("GUEST: " + text);
    const { output, usedFallback } = await understand(text, hotel, session);
    if (usedFallback) console.log("(fallback used)");
    console.log("REQUESTS:");
    if (output.requests.length === 0) console.log("  none");
    for (const r of output.requests) {
      console.log("  - [" + r.intent + "/" + r.priority + "] " + r.detail + (r.quantity ? " x" + r.quantity : "") + (r.whenText ? " (" + r.whenText + ")" : ""));
    }
    console.log("ARIA: " + output.reply);
    console.log("sentiment=" + output.sentiment + " needsHuman=" + output.needsHuman);
  }
}

main().catch((e) => console.error(e));
