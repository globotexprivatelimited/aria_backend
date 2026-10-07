import { prisma } from "../db";

const TABLE = "\"GuestConsent\"";

export const CONSENT_NOTICE =
  "Before we begin: I keep your messages only to handle your requests during your stay, and never share them with other guests. Reply STOP at any time and everything is erased.";

/** Where consent came from: the registration card at check-in, the guest writing to the hotel first, or a staff action. */
export type ConsentSource = "registration_card" | "guest_initiated" | "staff" | "import";

export async function getConsent(hotelId: string, guestPhone: string) {
  return prisma.guestConsent.findUnique({
    where: { hotelId_guestPhone: { hotelId, guestPhone } },
  });
}

export async function setConsentSource(hotelId: string, guestPhone: string, source: ConsentSource, note?: string): Promise<void> {
  await prisma.$executeRawUnsafe("update " + TABLE + " set consent_source = $1, consent_note = $2 where \"hotelId\" = $3 and \"guestPhone\" = $4", source, note ?? null, hotelId, guestPhone);
}

export async function recordConsent(hotelId: string, guestPhone: string, granted: boolean, source?: ConsentSource, note?: string) {
  const now = new Date();
  const row = await prisma.guestConsent.upsert({
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
  if (source) await setConsentSource(hotelId, guestPhone, source, note);
  return row;
}

/** A guest who writes to the hotel first has started the conversation themselves - recorded as such. */
export async function ensureConsentOnFirstContact(hotelId: string, guestPhone: string, source: ConsentSource = "guest_initiated", note = "guest wrote to the hotel first") {
  const existing = await getConsent(hotelId, guestPhone);
  if (existing) return { existing: true, consent: existing };
  const consent = await recordConsent(hotelId, guestPhone, true, source, note);
  return { existing: false, consent };
}

export type ConsentRow = { guestPhone: string; status: string; source: string; note: string | null; grantedAt: string | null; withdrawnAt: string | null; noticeVersion: string; createdAt: string };

/** Every consent record at a hotel with how it was obtained - the privacy record, exportable. */
export async function listConsent(hotelId: string): Promise<ConsentRow[]> {
  const rows = await prisma.$queryRawUnsafe<any[]>("select \"guestPhone\", status, \"noticeVersion\", \"grantedAt\", \"withdrawnAt\", consent_source, consent_note, \"createdAt\" from " + TABLE + " where \"hotelId\" = $1 order by \"createdAt\" desc", hotelId);
  const iso = (v: unknown) => (v ? new Date(v as string).toISOString() : null);
  return rows.map((r) => ({ guestPhone: String(r.guestPhone), status: String(r.status), source: r.consent_source ? String(r.consent_source) : "unrecorded (before sources were kept)", note: r.consent_note ?? null, grantedAt: iso(r.grantedAt), withdrawnAt: iso(r.withdrawnAt), noticeVersion: String(r.noticeVersion ?? ""), createdAt: iso(r.createdAt) ?? "" }));
}

/** Erase everything: a bare STOP (as the notice promises) or an explicit ask to delete their data - English, Hindi, Bengali. */
const ERASE = /^\s*(stop|unsubscribe|opt ?out)\s*[.!]*\s*$|\b(delete|erase|remove|wipe|clear)\b.{0,20}\b(my|our)\b.{0,20}\b(data|details|info|information|number|record|records|messages|history|chat)\b|\bforget me\b|\b(mera|meri|hamara|apna)\b.{0,15}\b(data|number|details?|record)\b.{0,15}\b(delete|hata|hatao|mita|mitao|khatam|uda)\b|\bdata\b.{0,12}\b(delete|hata|hatao|mita|mitao)\b.{0,8}\b(do|kar|karo|kardo|dijiye)\b|\bamar\b.{0,15}\b(data|number|details?)\b.{0,15}\b(delete|muche|muchhe|sorao|sorate|felun|felo)\b/i;
export function isWithdrawalKeyword(text: string): boolean {
  return ERASE.test((text ?? "").trim());
}

/** No more messages from us, but nothing erased: matched on intent, not an exact word. */
const OPTOUT = /\b(stop|quit|cease|no more|dont|don't|do not|never|please no)\b.{0,14}\b(messag|text|msg|sms|contact|whatsapp|notif|nudg|remind|disturb)/i;
const OPTOUT_HI = /\b(messag|msg|sms|text|notification)\w*\b.{0,16}\b(mat|na|nahi|nhi|band)\b.{0,12}\b(karo|karna|karein|kijiye|kar|bhejo|bhejna|bhej|bhejiye|do)\b|\bmujhe\b.{0,12}\b(message|msg|sms|text)\b.{0,12}\b(mat|na|nahi)\b|\b(disturb|tang|pareshan)\b.{0,10}\b(mat|na)\b/i;
const OPTOUT_BN = /\b(aar|ar|r)\b.{0,10}\b(message|msg|sms|text)\b.{0,20}\b(korben na|koro na|korona|korbe na|pathaben na|pathao na|pathio na|dio na|deben na|diben na)\b|\b(message|msg|sms)\b.{0,20}\b(pathaben na|korben na|dio na|deben na)\b|\bbirokto\b.{0,10}\bkorben na\b/i;
export function looksLikeOptOut(text: string): boolean {
  const t = (text ?? "").trim();
  return OPTOUT.test(t) || OPTOUT_HI.test(t) || OPTOUT_BN.test(t);
}
