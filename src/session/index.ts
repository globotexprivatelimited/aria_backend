import { prisma } from "../db";
import { matchesAny } from "../lib/match";
import { sendReply, notifyFrontDesk } from "../lib/notify";
import { log } from "../lib/logger";

const CHECKOUT_TERMS = ["checking out", "leaving today", "just checked out", "checked out", "on my way to airport", "heading to airport", "leaving now"];
const AFFIRM = ["yes", "yep", "yeah", "yup", "still here", "still staying", "i am", "we are", "staying"];
const NEGATE = ["no", "nope", "left", "checked out", "gone", "not anymore", "we left", "i left"];
const EVASIVE = ["why", "none", "private", "not telling", "won't", "wont", "rather not", "prefer not"];

export function looksLikeRoomNumber(text: string): boolean {
  return /^\s*(room\s*)?#?\s*\d{1,4}\s*$/i.test(text.trim());
}
function extractRoom(text: string): string {
  const m = text.match(/\d{1,4}/);
  return m ? m[0] : text.trim();
}
export function isEvasive(name: string): boolean {
  const n = name.trim().toLowerCase();
  if (n.length < 2) return true;
  if (/^\d+$/.test(n)) return true;
  return EVASIVE.some((e) => n.includes(e));
}
export function canDoRevenueAction(session: { state: string }): boolean {
  return session.state === "active";
}

async function getOrCreateSession(hotelId: string, guestPhone: string) {
  const existing = await prisma.session.findFirst({
    where: { hotelId, guestPhone, state: { not: "closed" } },
    orderBy: { createdAt: "desc" },
  });
  if (existing) return existing;
  return prisma.session.create({ data: { hotelId, guestPhone, state: "prospect" } });
}

async function closeSession(id: string, reason: string) {
  await prisma.session.update({ where: { id }, data: { state: "closed" } });
  log.info("session closed", { reason, sessionId: id });
}

async function verifyRoomClaim(hotelId: string, room: string, phone: string, currentId: string) {
  const other = await prisma.session.findFirst({
    where: { hotelId, roomNumber: room, state: "active", id: { not: currentId } },
    orderBy: { createdAt: "desc" },
  });
  if (!other) return "granted_unverified" as const;
  if (other.guestPhone === phone) return "granted_verified" as const;
  return "conflict" as const;
}

type SessionHotel = { hotelId: string; name: string };

export async function runSession(hotel: SessionHotel, guestPhone: string, text: string) {
  let session = await getOrCreateSession(hotel.hotelId, guestPhone);

  if (session.state === "blocked") {
    if (session.blockedUntil && session.blockedUntil.getTime() > Date.now()) {
      return { proceed: false, session };
    }
    session = await prisma.session.update({ where: { id: session.id }, data: { state: "prospect", blockedUntil: null } });
  }

  if (matchesAny(text, CHECKOUT_TERMS)) {
    await closeSession(session.id, "keyword checkout");
    await sendReply(guestPhone, "Thank you for staying with us - safe travels! Message us anytime if there's anything else.", hotel.hotelId);
    return { proceed: false, session };
  }

  if (session.state === "flagged") {
    if (matchesAny(text, AFFIRM)) {
      session = await prisma.session.update({ where: { id: session.id }, data: { state: "active", lastMessageAt: new Date() } });
      return { proceed: true, session };
    }
    if (matchesAny(text, NEGATE)) {
      await closeSession(session.id, "guest confirmed stay ended");
      await sendReply(guestPhone, "Thanks for letting us know - we hope to host you again soon!", hotel.hotelId);
      return { proceed: false, session };
    }
    await sendReply(guestPhone, "Are you still staying with us? (Your stay may have ended.)", hotel.hotelId);
    return { proceed: false, session };
  }

  if (session.state === "prospect") {
    if (!session.roomNumber) {
      if (looksLikeRoomNumber(text)) {
        const room = extractRoom(text);
        session = await prisma.session.update({ where: { id: session.id }, data: { roomNumber: room } });
        await sendReply(guestPhone, "Got it - Room " + room + ". Just to confirm, what name is the booking under?", hotel.hotelId);
        return { proceed: false, session };
      }
      await sendReply(guestPhone, "Welcome! I'm Aria, your concierge. To get you set up, could you tell me your room number?", hotel.hotelId);
      return { proceed: false, session };
    }
    if (!session.claimedGuestName) {
      const name = text.trim();
      if (isEvasive(name)) {
        await sendReply(guestPhone, "Let me connect you with our front desk to get you set up properly - one moment.", hotel.hotelId);
        await notifyFrontDesk(hotel.hotelId, "Could not verify Room " + session.roomNumber + " for " + guestPhone + " (no name given)");
        return { proceed: false, session };
      }
      const outcome = await verifyRoomClaim(hotel.hotelId, session.roomNumber, guestPhone, session.id);
      if (outcome === "conflict") {
        await sendReply(guestPhone, "Let me just double-check this with our front desk - one moment.", hotel.hotelId);
        await notifyFrontDesk(hotel.hotelId, "Phone " + guestPhone + " claims Room " + session.roomNumber + " but records show a different guest.");
        return { proceed: false, session };
      }
      const verified = outcome === "granted_verified";
      session = await prisma.session.update({
        where: { id: session.id },
        data: {
          state: "active",
          claimedGuestName: name,
          roomVerified: verified,
          verificationMethod: verified ? "front_desk_match" : "self_reported_unverified",
          checkInDate: new Date(),
          lastMessageAt: new Date(),
        },
      });
      await sendReply(guestPhone, "Perfect, you're all set, " + name + ". How can I help with your stay?", hotel.hotelId);
      return { proceed: false, session };
    }
  }

  session = await prisma.session.update({ where: { id: session.id }, data: { lastMessageAt: new Date() } });
  return { proceed: true, session };
}
