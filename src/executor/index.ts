import { prisma } from "../db";
import { log } from "../lib/logger";
import { notifyDepartment, notifyGM, notifyFrontDesk } from "../lib/notify";
import { loadDeptModes } from "../deptconfig/service";
import { departmentFor, isBooking, needsHumanJudgement, type Dept } from "./routing";
import { deptType, acknowledgementFor } from "./departmentModel";
import type { BrainOutput } from "../brain/schema";
import { canDoRevenueAction } from "../session";
import { createDiningBooking } from "../dining";
import { createActivityBooking } from "../activities";

type ExecHotel = { hotelId: string; name: string };
type ExecSession = {
  id: string;
  state: string;
  roomNumber: string | null;
  claimedGuestName: string | null;
  roomVerified: boolean;
};

export type ExecutionResult = {
  created: number;
  bookings: number;
  escalated: boolean;
  blocked: string[];
  deduped: number;
};

// A follow-up message must not re-create a request that is still open (D-033, D-046).
const DEDUP_WINDOW_MINUTES = Number(process.env.REQUEST_DEDUP_MINUTES ?? 90);
const DEDUP_SIMILARITY = 0.5;
const NUMBER_WORDS: Record<string, string> = { one: "1", two: "2", three: "3", four: "4", five: "5", six: "6", seven: "7", eight: "8", nine: "9", ten: "10", a: "1", an: "1" };
const STOP = new Set(["the", "to", "for", "please", "guest", "guests", "wants", "want", "would", "like", "requests", "requested", "request", "needs", "need", "asks", "asked", "delivered", "delivery", "send", "sent", "bring", "in", "of", "and", "my", "their", "room", "up"]);

function detailTokens(s: string): Set<string> {
  return new Set(
    s.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/)
      .map((w) => NUMBER_WORDS[w] ?? w)
      .filter((w) => w && !STOP.has(w) && !/^\d{3,4}$/.test(w)) // drop room numbers
  );
}
function detailSimilarity(a: string, b: string): number {
  const ta = detailTokens(a), tb = detailTokens(b);
  if (ta.size === 0 || tb.size === 0) return 0;
  let shared = 0;
  for (const t of ta) if (tb.has(t)) shared++;
  return shared / new Set([...ta, ...tb]).size;
}

/** An open request for the same guest, same intent, recent, and describing the same thing. */
async function findOpenDuplicate(hotelId: string, sessionId: string, intent: string, dept: Dept, detail: string) {
  const since = new Date(Date.now() - DEDUP_WINDOW_MINUTES * 60 * 1000);
  const open = await prisma.request.findMany({
    where: { hotelId, sessionId, intent: intent as never, department: dept as never, status: { in: ["received", "in_progress"] }, createdAt: { gte: since } },
    orderBy: { createdAt: "desc" },
    take: 10,
  });
  return open.find((o) => detailSimilarity(o.requestDetail ?? "", detail) >= DEDUP_SIMILARITY) ?? null;
}

/** Find the staff contact who should hear about this department. */
async function departmentContact(hotelId: string, dept: Dept) {
  const exact = await prisma.staffContact.findFirst({
    where: { hotelId, department: dept as never, isActive: true },
  });
  if (exact) return exact;
  return prisma.staffContact.findFirst({
    where: { hotelId, department: "front_desk" as never, isActive: true },
  });
}

export async function executeRequests(
  brain: BrainOutput,
  hotel: ExecHotel,
  session: ExecSession,
  guestPhone: string,
  messageId: string
): Promise<ExecutionResult> {
  const result: ExecutionResult = { created: 0, bookings: 0, escalated: false, blocked: [], deduped: 0 };
  // warm the per-hotel department mode cache so GM overrides apply to this request
  await loadDeptModes(hotel.hotelId);

  for (const r of brain.requests) {
    const dept = departmentFor(r.intent);
    const booking = isBooking(r.intent);

    // Revenue actions require a verified, active guest.
    if (booking && !canDoRevenueAction(session)) {
      result.blocked.push(r.intent);
      log.warn("executor: booking blocked - guest not verified", {
        phone: guestPhone,
        intent: r.intent,
        state: session.state,
      });
      await notifyFrontDesk(
        hotel.hotelId,
        "Unverified guest " + guestPhone + " attempted a " + r.intent + " booking. Verify before actioning."
      );
      continue;
    }

    // Activities are bookings with capacity, not tasks.
    if (r.intent === "activities") {
      await createActivityBooking(hotel, session, guestPhone, r.detail, r.quantity, r.whenText);
      result.bookings += 1;
      continue;
    }

    // Dining is a booking with its own confirmation lifecycle, not a task.
    if (r.intent === "dining") {
      await createDiningBooking(hotel, session, guestPhone, r.detail, r.quantity, r.whenText);
      result.bookings += 1;
      continue;
    }

    // Still-open request that says the same thing? Then this is a follow-up, not a new ask (D-033, D-046).
    const dup = await findOpenDuplicate(hotel.hotelId, session.id, r.intent, dept, r.detail);
    if (dup) {
      result.deduped += 1;
      log.info("executor: duplicate request skipped", { existingId: dup.id, intent: r.intent, detail: r.detail });
      continue;
    }

    const created = await prisma.request.create({
      data: {
        hotelId: hotel.hotelId,
        sessionId: session.id,
        roomNumber: session.roomNumber,
        guestPhone,
        messageId,
        intent: r.intent as never,
        department: dept as never,
        requestDetail: r.detail,
        ariaInterpretation: brain.reply,
        priority: r.priority as never,
        status: "received",
        deliveryLocation: session.roomNumber,
      },
    });

    result.created += 1;
    if (booking) result.bookings += 1;

    const room = session.roomNumber ?? "unknown";
    const dtype = deptType(dept, hotel.hotelId);
    const actionHint = dtype === "auto" || dtype === "maintenance" ? "Actions: CLAIM / DONE / PROBLEM" : "Actions: ACCEPT / DECLINE <reason> / ALTERNATIVE <option>";
    const urgency = r.priority === "urgent" ? "[URGENT] " : "";
    const line =
      urgency + "[" + created.id.slice(0, 8) + "] Room " + room + " - " + r.detail + (r.whenText ? " (" + r.whenText + ")" : "") + " | " + actionHint;

    await notifyDepartment(hotel.hotelId, dept, line);
    await prisma.request.update({ where: { id: created.id }, data: { notified: true } });

    const contact = await departmentContact(hotel.hotelId, dept);
    if (!contact) {
      log.warn("executor: no staff contact for department", { dept, hotelId: hotel.hotelId });
    }

    if (needsHumanJudgement(r)) {
      result.escalated = true;
      await notifyGM(hotel.hotelId, "Needs a human: Room " + room + " - " + r.detail);
    }

    log.info("executor: request created", {
      requestId: created.id,
      intent: r.intent,
      dept,
      priority: r.priority,
      booking,
    });
  }

  // An unhappy guest reaches the GM before they reach a review site.
  if (brain.sentiment === "unhappy" || brain.needsHuman) {
    result.escalated = true;
    await notifyGM(
      hotel.hotelId,
      "Unhappy guest in room " + (session.roomNumber ?? "unknown") + " (" + guestPhone + "). Please look now."
    );
    log.warn("executor: unhappy guest escalated to GM", { phone: guestPhone });
  }

  return result;
}
