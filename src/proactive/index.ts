import { eveningBefore } from "../lib/localtime";
import { prisma } from "../db";
import { log } from "../lib/logger";
import { sendReply } from "../lib/notify";

type TriggerType =
  | "welcome"
  | "evening_nudge"
  | "pre_checkout"
  | "feedback"
  | "activity_reminder"
  | "post_activity_upsell";

const MINUTES = 60 * 1000;
const HOURS = 60 * MINUTES;
const QUIET_FROM = 21 * 60 + 30; // nothing unprompted from 21:30 on the hotel's clock
const QUIET_TO = 8 * 60;          // until 08:00

/** The hotel's wall clock for an instant: local date (YYYY-MM-DD) and minutes since midnight. */
export function hotelClock(tz: string | null, at: Date): { date: string; minutes: number } {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone: tz ?? undefined, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(at);
    const get = (t: string) => parts.find((x) => x.type === t)?.value ?? "00";
    return { date: get("year") + "-" + get("month") + "-" + get("day"), minutes: Number(get("hour")) * 60 + Number(get("minute")) };
  } catch {
    return { date: at.toISOString().slice(0, 10), minutes: at.getUTCHours() * 60 + at.getUTCMinutes() };
  }
}

/** The instant at which the hotel's clock shows hh:mm on that local date - never the server's clock (Render is UTC; 18:30 UTC is midnight in India). */
export function atHotelTime(tz: string | null, localDate: string, hh: number, mm: number): Date {
  const guess = new Date(localDate + "T" + String(hh).padStart(2, "0") + ":" + String(mm).padStart(2, "0") + ":00Z");
  const shown = hotelClock(tz, guess);
  let offset = shown.minutes - (hh * 60 + mm);
  if (shown.date > localDate) offset += 1440;
  else if (shown.date < localDate) offset -= 1440;
  return new Date(guess.getTime() - offset * MINUTES);
}

function nextDay(localDate: string): string {
  const d = new Date(localDate + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/** What Aria says. Kept short - an unprompted message must earn its place. */
function messageFor(type: TriggerType, guestName: string | null, hotelName: string, extra?: string): string {
  const name = guestName ? " " + guestName.split(" ")[0] : "";

  switch (type) {
    case "welcome":
      return (name ? name.trim() + ", welcome" : "Welcome") + " to " + hotelName + "! I'm Aria - if you need anything at all during your stay, just message me here. Fresh towels, a table, a taxi, anything.";
    case "evening_nudge":
      return "Evening" + name + " - hope your day has been good. If you'd like a table tonight or anything sent up to your room, just say the word.";
    case "pre_checkout":
      return "Hope you've had a lovely stay" + name + ". Is there anything you need before you check out - a late checkout, help with bags, or a car to the airport?";
    case "feedback":
      return "Thank you for staying with us" + name + ". If there was anything we could have done better, I'd genuinely like to hear it - it goes straight to our manager.";
    case "activity_reminder":
      return "Just a reminder" + name + " - " + (extra ?? "your activity") + " is coming up shortly. Let me know if you need anything beforehand.";
    case "post_activity_upsell":
      return "How was " + (extra ?? "the activity") + name + "? If you enjoyed it, I'd be glad to arrange something similar - just let me know.";
  }
}

/** Book a message for later. Silently skipped if the guest has opted out. */
export async function schedule(
  hotelId: string,
  sessionId: string,
  guestPhone: string,
  triggerType: TriggerType,
  when: Date
): Promise<void> {
  const session = await prisma.session.findUnique({ where: { id: sessionId } });
  if (!session) return;
  if (session.proactiveOptedOut) {
    log.info("proactive: skipped, guest opted out", { phone: guestPhone, triggerType });
    return;
  }

  const already = await prisma.proactiveTrigger.findFirst({
    where: { hotelId, sessionId, triggerType: triggerType as never, status: "pending" },
  });
  if (already) return;

  await prisma.proactiveTrigger.create({
    data: {
      hotelId,
      sessionId,
      guestPhone,
      triggerType: triggerType as never,
      scheduledAt: when,
      status: "pending",
    },
  });

  log.info("proactive: scheduled", { triggerType, phone: guestPhone, at: when.toISOString() });
}

/** The arc of a stay, booked at check-in. */
export async function scheduleStayTriggers(
  hotelId: string,
  sessionId: string,
  guestPhone: string,
  checkOutDate?: Date | null
): Promise<void> {
  const now = Date.now();
  const hotel = await prisma.hotel.findUnique({ where: { hotelId } });
  const tz = hotel?.timezone ?? null;

  // 18:30 on the hotel's clock, not the server's
  const evening = atHotelTime(tz, hotelClock(tz, new Date()).date, 18, 30);
  if (evening.getTime() > now) {
    await schedule(hotelId, sessionId, guestPhone, "evening_nudge", evening);
  }

  if (checkOutDate) {
    const preCheckout = new Date(checkOutDate);
    preCheckout.setTime((await eveningBefore(hotelId, checkOutDate)).getTime());
    
    if (preCheckout.getTime() > now) {
      await schedule(hotelId, sessionId, guestPhone, "pre_checkout", preCheckout);
    }
  }
}

/** Around a confirmed activity: a nudge before, a follow-up after. */
export async function scheduleActivityTriggers(
  hotelId: string,
  sessionId: string | null,
  guestPhone: string,
  activityName: string | null,
  activityDate: Date | null
): Promise<void> {
  if (!sessionId || !activityDate) return;

  const hotel = await prisma.hotel.findUnique({ where: { hotelId } });
  const start = atHotelTime(hotel?.timezone ?? null, activityDate.toISOString().slice(0, 10), 9, 0);

  const remindAt = new Date(start.getTime() - 2 * HOURS);
  if (remindAt.getTime() > Date.now()) {
    await schedule(hotelId, sessionId, guestPhone, "activity_reminder", remindAt);
  }

  await schedule(hotelId, sessionId, guestPhone, "post_activity_upsell", new Date(start.getTime() + 3 * HOURS));
}

/** Nothing should reach a guest who has left. */
export async function cancelTriggersForSession(sessionId: string, reason: string): Promise<void> {
  const res = await prisma.proactiveTrigger.updateMany({
    where: { sessionId, status: "pending" },
    data: { status: "cancelled" },
  });
  if (res.count) log.info("proactive: cancelled pending triggers", { sessionId, count: res.count, reason });
}

/** Send everything that has come due. Runs on a schedule. */
export async function sendDueTriggers(): Promise<void> {
  if ((process.env.PROACTIVE_ENABLED ?? "true").toLowerCase() === "false") return;
  const due = await prisma.proactiveTrigger.findMany({
    where: { status: "pending", scheduledAt: { lte: new Date() } },
    take: 50,
    orderBy: { scheduledAt: "asc" },
  });

  for (const t of due) {
    const session = t.sessionId ? await prisma.session.findUnique({ where: { id: t.sessionId } }) : null;

    // The guest has checked out, or asked not to be messaged.
    if (!session || session.state === "closed" || session.proactiveOptedOut) {
      await prisma.proactiveTrigger.update({ where: { id: t.id }, data: { status: "cancelled" } });
      log.info("proactive: cancelled at send time", { triggerId: t.id, reason: session ? "closed or opted out" : "no session" });
      continue;
    }

    const hotel = await prisma.hotel.findUnique({ where: { hotelId: t.hotelId } });
    if (!hotel) continue;

    // A hotel handling an emergency should not be sending cheerful nudges.
    if (hotel.emergencyMode) {
      log.info("proactive: held back, hotel in emergency mode", { triggerId: t.id });
      continue;
    }

    // the hotel's clock decides: an evening nudge only in the evening, nothing unprompted late at night
    const clock = hotelClock(hotel.timezone ?? null, new Date());
    if (t.triggerType === "evening_nudge" && (clock.minutes < 17 * 60 || clock.minutes >= 21 * 60)) {
      await prisma.proactiveTrigger.update({ where: { id: t.id }, data: { status: "cancelled" } });
      log.warn("proactive: evening nudge outside 17:00-21:00 hotel time - cancelled", { triggerId: t.id, hotelMinutes: clock.minutes });
      continue;
    }
    if (clock.minutes >= QUIET_FROM || clock.minutes < QUIET_TO) {
      const next = atHotelTime(hotel.timezone ?? null, clock.minutes >= QUIET_FROM ? nextDay(clock.date) : clock.date, QUIET_TO / 60, 0);
      await prisma.proactiveTrigger.update({ where: { id: t.id }, data: { scheduledAt: next } });
      log.info("proactive: deferred to the morning - quiet hours", { triggerId: t.id, at: next.toISOString() });
      continue;
    }
    // a guest already talking to Aria does not need a nudge
    if (t.triggerType === "evening_nudge" && session.lastMessageAt && Date.now() - new Date(session.lastMessageAt).getTime() < 3 * HOURS) {
      await prisma.proactiveTrigger.update({ where: { id: t.id }, data: { status: "cancelled" } });
      log.info("proactive: evening nudge skipped - guest messaged recently", { triggerId: t.id });
      continue;
    }

    const text = messageFor(t.triggerType as TriggerType, session.claimedGuestName, hotel.name);
    await sendReply(t.guestPhone, text, t.hotelId);

    await prisma.proactiveTrigger.update({
      where: { id: t.id },
      data: { status: "sent", sentAt: new Date() },
    });

    log.info("proactive: sent", { triggerId: t.id, triggerType: t.triggerType, phone: t.guestPhone });
  }
}

/** Let a guest stop unprompted messages without erasing their data. */
export function isProactiveOptOut(text: string): boolean {
  const t = text.trim().toLowerCase();
  return [
    "stop messaging me",
    "no more messages",
    "do not message me",
    "dont message me",
    "leave me alone",
    "stop the reminders",
  ].some((p) => t.includes(p));
}

export async function optOutOfProactive(sessionId: string): Promise<void> {
  await prisma.session.update({ where: { id: sessionId }, data: { proactiveOptedOut: true } });
  await cancelTriggersForSession(sessionId, "guest opted out");
}
