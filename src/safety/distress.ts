import { prisma } from "../db";
import { log } from "../lib/logger";
import { sendReply, notifyFrontDesk, notifyGM } from "../lib/notify";
import { detectLanguage } from "../agent/language";

/**
 * A guest who may be in danger is answered and a person is sent - from code, before any AI runs, so it happens
 * even when the AI is down. Phrases in English, Hindi and Bengali, in Latin and native script. Some false
 * positives are accepted: a front-desk visit that turns out to be unnecessary costs nothing.
 */
const PATTERNS = [
  "\\b(don'?t|do not|dont) (want|wanna) to (be alive|live|wake up)\\b",
  "\\b(want|wanna|going|planning) to (die|kill myself|end (it all|my life|everything))\\b",
  "\\bkill(ing)? myself\\b", "\\bend my life\\b", "\\bsuicid(e|al)\\b", "\\b(hurt|harm|cut)(ing)? myself\\b", "\\bself[- ]?harm\\b",
  "\\bno (reason|point) (to|in) (live|living)\\b", "\\b(better off|be better) dead\\b", "\\boverdos(e|ing)\\b",
  "\\b(take|taking|took|swallow(ed)?) (all|whole|every) (the |my |of )?(pills|tablets|bottle)\\b",
  "\\b(jeena|jina) nahi (chahta|chahti|chahte|chahiye|hai)\\b", "\\bmarna (chahta|chahti|chahte|hai|h)\\b",
  "\\bmar (jana|jaana|jaun|jau|jaoon) (chahta|chahti|chahte)\\b", "\\bkhud ko (khatam|khatm|maar|marna|nuksan|nuksaan|chot)\\b",
  "\\bzindagi (khatam|khatm|se (tang|thak))\\b", "\\ba?atmahatya\\b", "\\bjaan de (doon|dunga|dungi|du)\\b", "\\bjeene ka (man|mann) nahi\\b",
  "\u092E\u0930\u0928\u093E \u091A\u093E\u0939\u0924", "\u091C\u0940\u0928\u093E \u0928\u0939\u0940\u0902", "\u0906\u0924\u094D\u092E\u0939\u0924\u094D\u092F\u093E", "\u0916\u0941\u0926 \u0915\u094B (\u0916\u0924\u094D\u092E|\u092E\u093E\u0930)",
  "\\b(banchte|bachte|bnachte) chai ?na\\b", "\\bmor(e|te) (jete )?chai\\b", "\\bnijeke (shesh|mere|khun)\\b", "\\ba?atmohotta\\b",
  "\u09AC\u09BE\u0981\u099A\u09A4\u09C7 \u099A\u09BE\u0987 \u09A8\u09BE", "\u09AE\u09B0\u09C7 \u09AF\u09C7\u09A4\u09C7 \u099A\u09BE\u0987", "\u09AE\u09B0\u09A4\u09C7 \u099A\u09BE\u0987", "\u0986\u09A4\u09CD\u09AE\u09B9\u09A4\u09CD\u09AF\u09BE",
];
const DISTRESS = new RegExp(PATTERNS.join("|"), "i");

export function looksLikeDistress(text: string): boolean {
  return DISTRESS.test((text ?? "").replace(/\s+/g, " "));
}

const EN = "I'm really glad you told me. You matter, and you don't have to go through this alone - someone from our team is coming to check on you now. If you'd like to talk to someone right away: Tele-MANAS 14416 (free, 24 hours, in any Indian language) or iCall 9152987821. If you are in immediate danger, call 112.";
const HI = "Aap akele nahi hain - hamari team abhi aapke paas aa rahi hai. Abhi kisi se baat karni ho toh Tele-MANAS 14416 (free, 24 ghante) par call karein. Turant khatra ho toh 112.";
const BN = "Apni eka non - amader team ekhoni apnar kachhe ashchhe. Ekhoni karo shathe kotha bolte chaile Tele-MANAS 14416 (free, 24 ghonta). Ekhoni bipod hole 112.";

export function distressReply(text: string): string { return replyFor(text); }

function replyFor(text: string): string {
  const lang = detectLanguage(text);
  if (lang === "Hindi" || lang === "Hinglish") return HI + "\n\n" + EN;
  if (lang === "Bengali" || lang === "Benglish") return BN + "\n\n" + EN;
  return EN;
}

/** True when the message was handled here: staff alerted, a card raised, the guest answered. Nothing in it can block the rest. */
export async function handleDistress(hotel: { hotelId: string; name: string }, guestPhone: string, text: string): Promise<boolean> {
  if (!looksLikeDistress(text)) return false;
  let session: { id: string; roomNumber: string | null; claimedGuestName: string | null } | null = null;
  try { session = await prisma.session.findFirst({ where: { hotelId: hotel.hotelId, guestPhone, state: { not: "closed" } }, select: { id: true, roomNumber: true, claimedGuestName: true } }); } catch { /* alert anyway */ }
  const room = session?.roomNumber ?? "unknown";
  const who = (session?.claimedGuestName ?? "").trim() || guestPhone;
  const alert = "URGENT - possible distress. Room " + room + ", " + who + " (" + guestPhone + ") wrote: \"" + text.trim().slice(0, 200) + "\". Please go to the room now and stay with the guest; call 112 if there is any danger.";
  const attempt = async (what: string, fn: () => Promise<unknown>) => { try { await fn(); } catch (e) { log.error("distress: " + what + " failed", { detail: e instanceof Error ? e.message : String(e) }); } };
  await attempt("front desk alert", () => notifyFrontDesk(hotel.hotelId, alert));
  await attempt("GM alert", () => notifyGM(hotel.hotelId, alert));
  await attempt("board card", () => prisma.request.create({ data: { hotelId: hotel.hotelId, sessionId: session?.id ?? null, roomNumber: session?.roomNumber ?? null, guestPhone, intent: "concierge" as never, department: "front_desk" as never, requestDetail: "WELLBEING CHECK NOW - " + alert, priority: "emergency" as never, status: "received" } }));
  await attempt("reply", () => sendReply(guestPhone, replyFor(text), hotel.hotelId));
  log.warn("distress: guest answered and staff alerted", { hotelId: hotel.hotelId, phone: guestPhone, room });
  return true;
}
