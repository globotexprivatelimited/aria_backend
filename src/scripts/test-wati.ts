import "dotenv/config";
import { sendWhatsAppMessage, isWatiConfigured } from "../lib/wati";

// EDIT THIS - your own WhatsApp number, with country code
const MY_NUMBER = "+919999999999";

async function main() {
  console.log("Wati configured:", isWatiConfigured());
  console.log("Endpoint:", process.env.WATI_API_URL);
  console.log("Token length:", (process.env.WATI_ACCESS_TOKEN ?? "").length);

  if (!isWatiConfigured()) {
    console.log("\nAdd WATI_API_URL and WATI_ACCESS_TOKEN to .env first.");
    return;
  }

  console.log("\nSending a test message to " + MY_NUMBER + "...");
  const ok = await sendWhatsAppMessage(MY_NUMBER, "Test from Aria. If you can read this, the connection works.");
  console.log(ok ? "\nSENT - check your phone." : "\nFAILED - see the error above.");
}

main().catch(console.error);
