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

  await schedule(hotelId, sessionId, guestPhone, "welcome", new Date(now + 10 * MINUTES));

  const evening = new Date();
  evening.setHours(18, 30, 0, 0);
  if (evening.getTime() > now) {
    await schedule(hotelId, sessionId, guestPhone, "evening_nudge", evening);
  }

  if (checkOutDate) {
    const preCheckout = new Date(checkOutDate);
    preCheckout.setHours(19, 0, 0, 0);
    preCheckout.setDate(preCheckout.getDate() - 1);
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

  const start = new Date(activityDate);
  start.setHours(9, 0, 0, 0);

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
