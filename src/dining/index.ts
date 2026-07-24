import { prisma } from "../db";
import { log } from "../lib/logger";
import { sendReply, notifyDepartment, notifyGM } from "../lib/notify";

export function shortRef(id: string): string {
  return id.slice(0, 8);
}

/** Guess the booking date from the guest's own words. Staff can correct it. */
function inferDate(whenText?: string): Date | null {
  if (!whenText) return null;
  const t = whenText.toLowerCase();
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  if (t.includes("tomorrow")) {
    const d = new Date(today);
    d.setDate(d.getDate() + 1);
    return d;
  }
  if (t.includes("tonight") || t.includes("today") || t.includes("this evening")) {
    return today;
  }
  return null;
}

type BookingHotel = { hotelId: string; name: string };
type BookingSession = { id: string; roomNumber: string | null; claimedGuestName: string | null };

/**
 * Create a dining booking in pending state and put it in front of the restaurant.
 * Nothing is confirmed here - a human owns that decision.
 */
export async function createDiningBooking(
  hotel: BookingHotel,
  session: BookingSession,
  guestPhone: string,
  detail: string,
  partySize?: number,
  whenText?: string
) {
  const booking = await prisma.diningBooking.create({
    data: {
      hotelId: hotel.hotelId,
      sessionId: session.id,
      roomNumber: session.roomNumber,
      guestPhone,
      partySize: partySize ?? null,
      bookingDate: inferDate(whenText),
      bookingTime: whenText ?? null,
      specialRequests: detail,
      status: "pending",
    },
  });

  const ref = shortRef(booking.id);
  const party = partySize ? partySize + " guest(s)" : "party size not given";
  const when = whenText ?? "time not given";
  const room = session.roomNumber ?? "unknown";

  await notifyDepartment(
    hotel.hotelId,
    "dining",
    "NEW TABLE REQUEST [" + ref + "] Room " + room + " - " + party + ", " + when +
      ". Reply CONFIRM " + ref + " / ALT " + ref + " <time> / DECLINE " + ref
  );

  await prisma.diningBooking.update({
    where: { id: booking.id },
    data: { notified: true, managerNotifiedAt: new Date() },
  });

  log.info("dining: booking created pending confirmation", { bookingId: booking.id, ref, room });
  return booking;
}

async function findByRef(hotelId: string, ref: string) {
  const candidates = await prisma.diningBooking.findMany({
    where: { hotelId, status: { in: ["pending", "alternative_offered"] } },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  return candidates.find((b) => b.id.startsWith(ref.toLowerCase())) ?? null;
}

export async function confirmBooking(hotelId: string, ref: string, staffName: string, revenue?: number) {
  const booking = await findByRef(hotelId, ref);
  if (!booking) return { ok: false, message: "No open booking found with reference " + ref + "." };

  await prisma.diningBooking.update({
    where: { id: booking.id },
    data: {
      status: "confirmed",
      confirmedAt: new Date(),
      managerNotes: "Confirmed by " + staffName,
      revenueGenerated: revenue ?? 0,
    },
  });

  const when = booking.bookingTime ?? "the requested time";
  await sendReply(
    booking.guestPhone,
    "Good news - your table is confirmed for " + when + ". We look forward to seeing you.",
    hotelId
  );

  log.info("dining: booking confirmed", { bookingId: booking.id, staffName, revenue: revenue ?? 0 });
  return { ok: true, message: "Confirmed booking " + ref + " and told the guest." };
}

export async function offerAlternative(hotelId: string, ref: string, altTime: string, staffName: string) {
  const booking = await findByRef(hotelId, ref);
  if (!booking) return { ok: false, message: "No open booking found with reference " + ref + "." };

  await prisma.diningBooking.update({
    where: { id: booking.id },
    data: {
      status: "alternative_offered",
      bookingTime: altTime,
      managerNotes: "Alternative offered by " + staffName,
    },
  });

  await sendReply(
    booking.guestPhone,
    "We are fully booked at that time, but we can offer " + altTime +
      ". Would that suit you? Just reply and I will let the restaurant know.",
    hotelId
  );

  log.info("dining: alternative offered", { bookingId: booking.id, altTime, staffName });
  return { ok: true, message: "Offered " + altTime + " for booking " + ref + "." };
}

export async function declineBooking(hotelId: string, ref: string, staffName: string, reason?: string) {
  const booking = await findByRef(hotelId, ref);
  if (!booking) return { ok: false, message: "No open booking found with reference " + ref + "." };

  await prisma.diningBooking.update({
    where: { id: booking.id },
    data: { status: "declined", managerNotes: "Declined by " + staffName + (reason ? ": " + reason : "") },
  });

  await sendReply(
    booking.guestPhone,
    "I am sorry - the restaurant is fully committed at that time. Our front desk would be glad to suggest somewhere nearby if that helps.",
    hotelId
  );

  log.info("dining: booking declined", { bookingId: booking.id, staffName });
  return { ok: true, message: "Declined booking " + ref + " and told the guest." };
}

/** A guest should never be left waiting on a table. Escalate anything ignored. */
export async function escalateStaleBookings(): Promise<void> {
  const cutoff = new Date(Date.now() - Number(process.env.DINING_ESCALATE_MINUTES ?? 20) * 60 * 1000);

  const stale = await prisma.diningBooking.findMany({
    where: { status: "pending", escalatedAt: null, managerNotifiedAt: { lt: cutoff } },
  });

  for (const b of stale) {
    await notifyGM(
      b.hotelId,
      "Table request [" + shortRef(b.id) + "] for room " + (b.roomNumber ?? "?") +
        " has had no reply from the restaurant. Please chase."
    );
    await prisma.diningBooking.update({ where: { id: b.id }, data: { escalatedAt: new Date() } });
    log.warn("dining: stale booking escalated to GM", { bookingId: b.id });
  }
}
