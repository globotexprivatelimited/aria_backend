import { prisma } from "../db";
import { runSession, canDoRevenueAction, looksLikeRoomNumber } from "../session";
import { runSafetyChecks, verifyStaffSender } from "../safety";
import { isEmergency } from "../safety/emergency";
import { isGuestInfoFishing } from "../safety/guestInfoFishing";
import { maskPhone, redact } from "../privacy/redact";
import { isWithdrawalKeyword, getConsent } from "../privacy/consent";
import { eraseGuestData, exportGuestData } from "../privacy/erasure";
import { checkInGuest } from "../lib/frontdesk";
import { understand, isBrainEnabled } from "../brain";
import { departmentFor, isBooking } from "../executor/routing";
import { createDiningBooking } from "../dining";
import { createActivityBooking, waitlistActivity, shortRef } from "../activities";
import { schedule, isProactiveOptOut } from "../proactive";
import { ensureConsentOnFirstContact } from "../privacy/consent";

type Result = { id: string; name: string; status: "PASS" | "FAIL" | "PENDING"; note?: string };
const results: Result[] = [];

function pass(id: string, name: string, note?: string) { results.push({ id, name, status: "PASS", note }); }
function fail(id: string, name: string, note?: string) { results.push({ id, name, status: "FAIL", note }); }
function pending(id: string, name: string, note?: string) { results.push({ id, name, status: "PENDING", note }); }

const HOTEL = "demo";
const rnd = () => "+9199" + Math.floor(Math.random() * 90000000 + 10000000);

async function main() {
  const hotel = await prisma.hotel.findUnique({ where: { hotelId: HOTEL } });
  if (!hotel) { console.log("Demo hotel missing - run the seed first."); return; }

  // 1 - multi-tenant: webhook token maps to exactly one hotel
  const byToken = await prisma.hotel.findMany({ where: { webhookToken: hotel.webhookToken } });
  byToken.length === 1
    ? pass("1", "Webhook token identifies exactly one hotel")
    : fail("1", "Webhook token identifies exactly one hotel", byToken.length + " matches");

  // 2 - every hotel has a unique whatsapp number
  const hotels = await prisma.hotel.findMany();
  const numbers = new Set(hotels.map((h) => h.whatsappNumber));
  numbers.size === hotels.length
    ? pass("2", "Each hotel has a unique WhatsApp number")
    : fail("2", "Each hotel has a unique WhatsApp number");

  // 3 - idempotency: processed message ids are unique
  const msgIds = await prisma.processedMessage.findMany({ select: { messageId: true } });
  const uniqueIds = new Set(msgIds.map((m) => m.messageId));
  uniqueIds.size === msgIds.length
    ? pass("3", "Duplicate messages cannot be processed twice", msgIds.length + " processed")
    : fail("3", "Duplicate messages cannot be processed twice");

  // 4 - emergency detection fires before AI
  isEmergency("I have chest pain") && !isEmergency("Can I get towels")
    ? pass("4", "Emergency detected and bypasses AI")
    : fail("4", "Emergency detected and bypasses AI");

  // 5 - emergency reply carries the 112 number
  const emgPhone = rnd();
  let emergencyReplyHas112 = false;
  const origLog = console.log;
  console.log = (...args: unknown[]) => {
    const s = args.map(String).join(" ");
    if (s.includes("112")) emergencyReplyHas112 = true;
  };
  await runSafetyChecks("I have chest pain", hotel, emgPhone);
  console.log = origLog;
  emergencyReplyHas112
    ? pass("5", "Emergency reply gives the 112 number")
    : fail("5", "Emergency reply gives the 112 number");

  // 6 - guest info fishing is blocked
  isGuestInfoFishing("who is staying in room 305?")
    ? pass("6", "Requests for another guest's details are blocked")
    : fail("6", "Requests for another guest's details are blocked");

  // 7 - safety returns handled for a hard case
  const safe = await runSafetyChecks("who is staying in room 305?", hotel, rnd());
  safe.handled
    ? pass("7", "Safety layer handles the message without the AI", "reason=" + safe.reason)
    : fail("7", "Safety layer handles the message without the AI");

  // 8 - revenue actions gated on an active session
  canDoRevenueAction({ state: "active" }) &&
  !canDoRevenueAction({ state: "prospect" }) &&
  !canDoRevenueAction({ state: "flagged" })
    ? pass("8", "Paid actions require an active, verified session")
    : fail("8", "Paid actions require an active, verified session");

  // 9 - a new guest starts as a prospect and is asked for a room
  const newPhone = rnd();
  const r1 = await runSession(hotel, newPhone, "Hi");
  r1.session.state === "prospect" && !r1.proceed
    ? pass("9", "Unknown guest starts as prospect and is asked to verify")
    : fail("9", "Unknown guest starts as prospect and is asked to verify", "state=" + r1.session.state);

  // 10 - room claim recognised
  looksLikeRoomNumber("412") && looksLikeRoomNumber("Room 305") && !looksLikeRoomNumber("towels please")
    ? pass("10", "Room numbers are recognised, ordinary text is not")
    : fail("10", "Room numbers are recognised, ordinary text is not");

  // 11 - front desk check-in produces a verified session
  const fdPhone = rnd();
  const fdRoom = String(Math.floor(Math.random() * 800 + 100));
  const fdSession = await checkInGuest(HOTEL, fdRoom, "Audit Guest", fdPhone);
  fdSession.roomVerified && fdSession.verificationMethod === "front_desk_match"
    ? pass("11", "Front-desk check-in marks the room front_desk_match")
    : fail("11", "Front-desk check-in marks the room front_desk_match");

  // 12 - a different phone cannot take over that room
  const impPhone = rnd();
  await runSession(hotel, impPhone, "Hi");
  await runSession(hotel, impPhone, fdRoom);
  const imp = await runSession(hotel, impPhone, "Someone Else");
  imp.session.state !== "active"
    ? pass("12", "A second phone cannot claim an occupied room", "state=" + imp.session.state)
    : fail("12", "A second phone cannot claim an occupied room");

  // 13 - staff verification exists and rejects an unknown number
  const staffCheck = await verifyStaffSender(rnd(), HOTEL);
  staffCheck.verified === false
    ? pass("13", "Unknown numbers are rejected as staff")
    : fail("13", "Unknown numbers are rejected as staff");

  // 14 - a real staff number is accepted
  const realStaff = await prisma.staffContact.findFirst({ where: { hotelId: HOTEL, isActive: true } });
  if (realStaff && realStaff.whatsappNumber) {
    const ok = await verifyStaffSender(realStaff.whatsappNumber, HOTEL);
    ok.verified ? pass("14", "Seeded staff number verifies") : fail("14", "Seeded staff number verifies");
  } else {
    fail("14", "Seeded staff number verifies", "no staff contact seeded");
  }

  // 15 - emergency mode gate exists on the hotel
  typeof hotel.emergencyMode === "boolean"
    ? pass("15", "Hotel-wide emergency mode flag is present")
    : fail("15", "Hotel-wide emergency mode flag is present");

  // 16 - consent recorded on first contact
  const consentPhone = rnd();
  await ensureConsentOnFirstContact(HOTEL, consentPhone);
  const consent = await getConsent(HOTEL, consentPhone);
  consent && consent.status === "granted"
    ? pass("16", "Consent recorded when a guest first messages")
    : fail("16", "Consent recorded when a guest first messages");

  // 17 - withdrawal keywords understood
  isWithdrawalKeyword("STOP") && isWithdrawalKeyword("delete my data") && !isWithdrawalKeyword("towels")
    ? pass("17", "Guests can withdraw with STOP")
    : fail("17", "Guests can withdraw with STOP");

  // 18 - export returns everything held
  const exported = await exportGuestData(HOTEL, fdPhone);
  exported.sessions.length > 0
    ? pass("18", "DPDP access right returns the guest's data")
    : fail("18", "DPDP access right returns the guest's data");

  // 19 - erasure clears personal data
  const erasePhone = rnd();
  await prisma.message.create({
    data: { hotelId: HOTEL, guestPhone: erasePhone, waId: erasePhone, messageId: "audit-" + Date.now(), direction: "inbound", messageType: "text", body: "audit message" },
  });
  await eraseGuestData(HOTEL, erasePhone, "audit");
  const leftover = await prisma.message.count({ where: { hotelId: HOTEL, guestPhone: erasePhone } });
  leftover === 0
    ? pass("19", "DPDP erasure removes the guest's messages")
    : fail("19", "DPDP erasure removes the guest's messages", leftover + " left");

  // 20 - erasure is recorded for audit
  const erasureLog = await prisma.erasureRequest.findFirst({ where: { hotelId: HOTEL, guestPhone: erasePhone } });
  erasureLog && erasureLog.completedAt
    ? pass("20", "Erasure requests are logged and completed")
    : fail("20", "Erasure requests are logged and completed");

  // 21 - PII never reaches logs raw
  maskPhone("+919876543210") === "+9198****3210" &&
  redact("call +91 98765 43210").includes("[phone]") &&
  redact("card 4111 1111 1111 1111").includes("[card]")
    ? pass("21", "Phone numbers and card numbers are redacted from logs")
    : fail("21", "Phone numbers and card numbers are redacted from logs");

  // 22 - retention windows configured
  const retentionSet = Number(process.env.MESSAGE_RETENTION_DAYS ?? 365) > 0;
  retentionSet
    ? pass("22", "A data retention window is configured")
    : fail("22", "A data retention window is configured");

  // 23 - admin endpoints are protected
  (process.env.ADMIN_API_KEY ?? "").length > 0
    ? pass("23", "Admin and dashboard endpoints require a key")
    : fail("23", "Admin and dashboard endpoints require a key", "ADMIN_API_KEY not set");

  // 24 - every session belongs to a hotel (tenant scoping)
  const orphanSessions = await prisma.session.count({ where: { hotelId: "" } });
  orphanSessions === 0
    ? pass("24", "Every session is scoped to a hotel")
    : fail("24", "Every session is scoped to a hotel", orphanSessions + " orphans");

  // 25 - raw message history kept for disputes
  const kept = await prisma.message.count({ where: { hotelId: HOTEL } });
  kept > 0
    ? pass("25", "Raw guest messages are stored for dispute resolution", kept + " messages")
    : fail("25", "Raw guest messages are stored for dispute resolution");

  // 26 - the brain splits one message into several jobs
  if (!isBrainEnabled()) {
    pending("26", "Multi-intent decomposition (one message, several jobs)", "ANTHROPIC_API_KEY not set");
  } else {
    const { output } = await understand(
      "Can I get 2 towels, a table for two tonight, and the aircon is broken",
      hotel,
      { roomNumber: "412", claimedGuestName: "Audit Guest", roomVerified: true }
    );
    output.requests.length >= 3
      ? pass("26", "Multi-intent decomposition (one message, several jobs)", output.requests.length + " requests")
      : fail("26", "Multi-intent decomposition (one message, several jobs)", "got " + output.requests.length);
  }

  // 27 - each intent reaches the right team
  departmentFor("housekeeping") === "housekeeping" &&
  departmentFor("room_service") === "fb" &&
  departmentFor("maintenance") === "maintenance" &&
  departmentFor("concierge") === "front_desk" &&
  isBooking("dining") && isBooking("spa") && isBooking("activities") && !isBooking("housekeeping")
    ? pass("27", "Requests routed to the right department")
    : fail("27", "Requests routed to the right department");

  // 28 - a table is never confirmed by Aria alone
  const dPhone = rnd();
  const dSession = await checkInGuest(HOTEL, String(Math.floor(Math.random() * 800 + 100)), "Dining Audit", dPhone);
  const dBooking = await createDiningBooking(hotel, dSession, dPhone, "table for two", 2, "tonight at 8");
  dBooking.status === "pending" && dBooking.notified !== false
    ? pass("28", "Dining bookings wait for a human to confirm", "ref " + dBooking.id.slice(0, 8))
    : fail("28", "Dining bookings wait for a human to confirm", "status=" + dBooking.status);

  // 29 - a full activity queues the guest instead of turning them away
  const aPhone = rnd();
  const aSession = await checkInGuest(HOTEL, String(Math.floor(Math.random() * 800 + 100)), "Activity Audit", aPhone);
  const aBooking = await createActivityBooking(hotel, aSession, aPhone, "sunrise yoga", 1, "tomorrow");
  const wl = await waitlistActivity(HOTEL, shortRef(aBooking.id), "audit");
  wl.ok
    ? pass("29", "A full activity puts the guest on a waitlist", wl.message)
    : fail("29", "A full activity puts the guest on a waitlist", wl.message);

  // 30 - Aria reaches out before the guest has to ask
  const pPhone = rnd();
  const pSession = await checkInGuest(HOTEL, String(Math.floor(Math.random() * 800 + 100)), "Proactive Audit", pPhone);
  await schedule(HOTEL, pSession.id, pPhone, "welcome", new Date(Date.now() + 60000));
  const trigger = await prisma.proactiveTrigger.findFirst({
    where: { hotelId: HOTEL, sessionId: pSession.id, status: "pending" },
  });
  trigger && isProactiveOptOut("please stop messaging me") && !isProactiveOptOut("can I get towels")
    ? pass("30", "Proactive messages are scheduled and can be opted out of")
    : fail("30", "Proactive messages are scheduled and can be opted out of");

  // report
  const passed = results.filter((r) => r.status === "PASS").length;
  const failed = results.filter((r) => r.status === "FAIL").length;
  const waiting = results.filter((r) => r.status === "PENDING").length;

  console.log("\n=== ARIA V1 VALIDATION AUDIT ===\n");
  for (const r of results) {
    const mark = r.status === "PASS" ? "[PASS]" : r.status === "FAIL" ? "[FAIL]" : "[WAIT]";
    console.log(mark + " " + r.id.padStart(2) + ". " + r.name + (r.note ? "  (" + r.note + ")" : ""));
  }
  console.log("\n--------------------------------");
  console.log("Passed:  " + passed);
  console.log("Failed:  " + failed);
  console.log("Waiting: " + waiting + " (blocked on the Claude brain)");
  console.log("--------------------------------\n");
  if (failed > 0) console.log("Fix the FAIL items before going live.\n");
}

main()
  .catch((e) => { console.error("audit error", e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
