import { prisma } from "../db";
import { log } from "../lib/logger";
import { sendReply, notifyDepartment, notifyGM } from "../lib/notify";
import { scheduleActivityTriggers } from "../proactive";

const HOLD_MINUTES = Number(process.env.WAITLIST_HOLD_MINUTES ?? 60);

export function shortRef(id: string): string {
  return id.slice(0, 8);
}

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
  if (t.includes("today") || t.includes("tonight") || t.includes("this morning") || t.includes("this evening")) {
    return today;
  }
  return null;
}

type ActHotel = { hotelId: string; name: string };
type ActSession = { id: string; roomNumber: string | null; claimedGuestName: string | null };

/** Create a pending activity booking and put it in front of the activities desk. */
export async function createActivityBooking(
  hotel: ActHotel,
  session: ActSession,
  guestPhone: string,
  detail: string,
  partySize?: number,
  whenText?: string
) {
  const booking = await prisma.activityBooking.create({
    data: {
      hotelId: hotel.hotelId,
      sessionId: session.id,
      guestPhone,
      roomNumber: session.roomNumber,
      activityName: detail.slice(0, 120),
      partySize: partySize ?? 1,
      activityDate: inferDate(whenText),
      preferredTime: whenText ?? null,
      specialRequirements: detail,
      status: "pending",
    },
  });

  const ref = shortRef(booking.id);
  const room = session.roomNumber ?? "unknown";
  const party = partySize ? partySize + " guest(s)" : "1 guest";

  await notifyDepartment(
    hotel.hotelId,
    "activities",
    "NEW ACTIVITY REQUEST [" + ref + "] Room " + room + " - " + detail + " (" + party +
      (whenText ? ", " + whenText : "") + "). Reply CONFIRM " + ref + " <price> / WAITLIST " + ref + " / DECLINE " + ref
  );

  await prisma.activityBooking.update({
    where: { id: booking.id },
    data: { notified: true, coordinatorNotified: true },
  });

  log.info("activities: booking created pending", { bookingId: booking.id, ref, room });
  return booking;
}

async function findByRef(hotelId: string, ref: string, statuses: string[]) {
  const rows = await prisma.activityBooking.findMany({
    where: { hotelId, status: { in: statuses as never } },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  return rows.find((b) => b.id.startsWith(ref.toLowerCase())) ?? null;
}

export async function confirmActivity(hotelId: string, ref: string, staffName: string, pricePerPerson?: number) {
  const booking = await findByRef(hotelId, ref, ["pending", "waitlisted"]);
  if (!booking) return { ok: false, message: "No open activity found with reference " + ref + "." };

  const price = pricePerPerson ?? 0;
  const party = booking.partySize ?? 1;
  const total = price * party;

  await prisma.activityBooking.update({
    where: { id: booking.id },
    data: {
      status: "confirmed",
      vendorConfirmed: true,
      pricePerPerson: price,
      totalRevenue: total,
    },
  });

  await prisma.activityWaitlist.deleteMany({ where: { hotelId, guestPhone: booking.guestPhone, activityName: booking.activityName } });

  await sendReply(
    booking.guestPhone,
    "Lovely - your place is confirmed for " + (booking.activityName ?? "the activity") +
      (booking.preferredTime ? " (" + booking.preferredTime + ")" : "") + ". We will send you the details shortly.",
    hotelId
  );

  await scheduleActivityTriggers(hotelId, booking.sessionId, booking.guestPhone, booking.activityName, booking.activityDate);

  log.info("activities: confirmed", { bookingId: booking.id, staffName, total });
  return { ok: true, message: "Confirmed activity " + ref + ". Revenue recorded: " + total + "." };
}

/** The activity is full - queue the guest rather than turning them away. */
export async function waitlistActivity(hotelId: string, ref: string, staffName: string) {
  const booking = await findByRef(hotelId, ref, ["pending"]);
  if (!booking) return { ok: false, message: "No pending activity found with reference " + ref + "." };

  const ahead = await prisma.activityWaitlist.count({
    where: { hotelId, activityName: booking.activityName, activityDate: booking.activityDate },
  });
  const position = ahead + 1;

  await prisma.activityWaitlist.create({
    data: {
      hotelId,
      activityName: booking.activityName,
      activityDate: booking.activityDate,
      guestPhone: booking.guestPhone,
      roomNumber: booking.roomNumber,
      partySize: booking.partySize,
      position,
    },
  });

  await prisma.activityBooking.update({ where: { id: booking.id }, data: { status: "waitlisted" } });

  await sendReply(
    booking.guestPhone,
    "That one is fully booked, but I have put you on the waitlist at position " + position +
      ". If a place opens up I will let you know straight away.",
    hotelId
  );

  log.info("activities: waitlisted", { bookingId: booking.id, position, staffName });
  return { ok: true, message: "Waitlisted " + ref + " at position " + position + "." };
}

export async function declineActivity(hotelId: string, ref: string, staffName: string, reason?: string) {
  const booking = await findByRef(hotelId, ref, ["pending", "waitlisted"]);
  if (!booking) return { ok: false, message: "No open activity found with reference " + ref + "." };

  await prisma.activityBooking.update({ where: { id: booking.id }, data: { status: "cancelled" } });

  await sendReply(
    booking.guestPhone,
    "I am sorry - we are not able to arrange that one" + (reason ? " (" + reason + ")" : "") +
      ". Our concierge would be glad to suggest something else.",
    hotelId
  );

  log.info("activities: declined", { bookingId: booking.id, staffName });
  return { ok: true, message: "Declined activity " + ref + "." };
}

/**
 * A confirmed place is given up. Offer it to whoever is first in the queue,
 * with a hold so they are not rushed but the place is not lost either.
 */
export async function cancelActivity(hotelId: string, ref: string, staffName: string) {
  const booking = await findByRef(hotelId, ref, ["confirmed"]);
  if (!booking) return { ok: false, message: "No confirmed activity found with reference " + ref + "." };

  await prisma.activityBooking.update({
    where: { id: booking.id },
    data: { status: "cancelled", totalRevenue: 0 },
  });

  await sendReply(booking.guestPhone, "Your place has been cancelled as requested. Do let me know if you would like to rebook.", hotelId);

  const promoted = await promoteFromWaitlist(hotelId, booking.activityName, booking.activityDate);

  log.info("activities: cancelled", { bookingId: booking.id, staffName, promoted: Boolean(promoted) });
  return {
    ok: true,
    message: "Cancelled " + ref + "." + (promoted ? " Offered the place to the next guest on the waitlist." : " Nobody was waiting."),
  };
}

/** Offer a freed place to the first guest in the queue. */
export async function promoteFromWaitlist(hotelId: string, activityName: string | null, activityDate: Date | null) {
  const next = await prisma.activityWaitlist.findFirst({
    where: { hotelId, activityName, activityDate, notifiedAt: null },
    orderBy: { position: "asc" },
  });
  if (!next) return null;

  const holdUntil = new Date(Date.now() + HOLD_MINUTES * 60 * 1000);

  await prisma.activityWaitlist.update({
    where: { id: next.id },
    data: { notifiedAt: new Date(), holdUntil },
  });

  await sendReply(
    next.guestPhone,
    "Good news - a place has opened up for " + (activityName ?? "the activity") +
      ". I am holding it for you for the next " + HOLD_MINUTES + " minutes. Just reply YES and it is yours.",
    hotelId
  );

  log.info("activities: waitlist place offered", { waitlistId: next.id, holdUntil });
  return next;
}

/** If an offered place is not taken in time, pass it to the next guest. */
export async function expireWaitlistHolds(): Promise<void> {
  const expired = await prisma.activityWaitlist.findMany({
    where: { holdUntil: { lt: new Date() }, notifiedAt: { not: null } },
  });

  for (const entry of expired) {
    await prisma.activityWaitlist.delete({ where: { id: entry.id } });
    log.info("activities: waitlist hold expired", { waitlistId: entry.id });
    await promoteFromWaitlist(entry.hotelId, entry.activityName, entry.activityDate);
  }
}
