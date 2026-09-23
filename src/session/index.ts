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

  // Only numbers registered by reception at check-in may chat.
  if (!session.roomVerified) {
    await sendReply(guestPhone, "Hello, and welcome. I don't have this number on our guest list for " + hotel.name + " yet \u2014 ask reception to add it and I'll be right here, ready to help with anything during your stay.", hotel.hotelId);
    return { proceed: false, session };
  }

  if (matchesAny(text, CHECKOUT_TERMS)) {
    await closeSession(session.id, "keyword checkout");
    await sendReply(guestPhone, "Thank you for staying with us \u2014 safe travels. If you've left something behind, our front desk will gladly help.", hotel.hotelId);
    return { proceed: false, session };
  }

  if (session.state === "flagged") {
    if (matchesAny(text, AFFIRM) || (session.checkOutDate && new Date(session.checkOutDate).getTime() + 86400000 > Date.now())) {
      session = await prisma.session.update({ where: { id: session.id }, data: { state: "active", lastMessageAt: new Date() } });
      return { proceed: true, session };
    }
    if (matchesAny(text, NEGATE)) {
      await closeSession(session.id, "guest confirmed stay ended");
      await sendReply(guestPhone, "Thank you for letting me know. It was a pleasure having you \u2014 we hope to welcome you back before long.", hotel.hotelId);
      return { proceed: false, session };
    }
    await sendReply(guestPhone, "Quick check before I help \u2014 are you still with us at the hotel?", hotel.hotelId);
    return { proceed: false, session };
  }

  if (session.state === "prospect") {
    if (!session.roomNumber) {
      if (looksLikeRoomNumber(text)) {
        const room = extractRoom(text);
        session = await prisma.session.update({ where: { id: session.id }, data: { roomNumber: room } });
        await sendReply(guestPhone, "Room " + room + ", noted. Just to be sure I'm looking at the right stay \u2014 what name is the booking under?", hotel.hotelId);
        return { proceed: false, session };
      }
      await sendReply(guestPhone, "Welcome \u2014 I'm Aria, the concierge here. Which room are you in? Then I can take care of anything you need.", hotel.hotelId);
      return { proceed: false, session };
    }
    if (!session.claimedGuestName) {
      const name = text.trim();
      if (isEvasive(name)) {
        await sendReply(guestPhone, "Let me get our front desk to set this up properly for you \u2014 one moment.", hotel.hotelId);
        await notifyFrontDesk(hotel.hotelId, "Could not verify Room " + session.roomNumber + " for " + guestPhone + " (no name given)");
        return { proceed: false, session };
      }
      const outcome = await verifyRoomClaim(hotel.hotelId, session.roomNumber, guestPhone, session.id);
      if (outcome === "conflict") {
        await sendReply(guestPhone, "Let me confirm one detail with our front desk \u2014 one moment, and I'll be right back to you.", hotel.hotelId);
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
      await sendReply(guestPhone, "You're all set, " + name + ". Anything you need \u2014 food, housekeeping, the spa, a car \u2014 just tell me here.", hotel.hotelId);
      return { proceed: false, session };
    }
  }

  session = await prisma.session.update({ where: { id: session.id }, data: { lastMessageAt: new Date() } });
  return { proceed: true, session };
}
