import { prisma } from "../db";
import { log } from "../lib/logger";
import { notifyDepartment, notifyGM, notifyFrontDesk } from "../lib/notify";
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
};

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
  const result: ExecutionResult = { created: 0, bookings: 0, escalated: false, blocked: [] };

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
    const dtype = deptType(dept);
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
