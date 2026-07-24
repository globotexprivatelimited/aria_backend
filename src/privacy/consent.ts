import { prisma } from "../db";

export const CONSENT_NOTICE =
  "We use your messages to handle your requests during your stay. Your data is kept only as long as needed and never shared with other guests. Reply STOP at any time to withdraw and have your data erased.";

export async function getConsent(hotelId: string, guestPhone: string) {
  return prisma.guestConsent.findUnique({
    where: { hotelId_guestPhone: { hotelId, guestPhone } },
  });
}

export async function recordConsent(hotelId: string, guestPhone: string, granted: boolean) {
  const now = new Date();
  return prisma.guestConsent.upsert({
    where: { hotelId_guestPhone: { hotelId, guestPhone } },
    update: granted
      ? { status: "granted", grantedAt: now, withdrawnAt: null }
      : { status: "withdrawn", withdrawnAt: now },
    create: {
      hotelId,
      guestPhone,
      status: granted ? "granted" : "withdrawn",
      grantedAt: granted ? now : null,
      withdrawnAt: granted ? null : now,
    },
  });
}

export async function ensureConsentOnFirstContact(hotelId: string, guestPhone: string) {
  const existing = await getConsent(hotelId, guestPhone);
  if (existing) return { existing: true, consent: existing };
  const consent = await recordConsent(hotelId, guestPhone, true);
  return { existing: false, consent };
}

export function isWithdrawalKeyword(text: string): boolean {
  const t = text.trim().toLowerCase();
  return ["stop", "unsubscribe", "delete my data", "erase my data", "forget me", "opt out"].includes(t);
}
