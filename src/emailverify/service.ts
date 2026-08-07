import { prisma } from "../db";
import crypto from "crypto";
import { sendVerificationEmail } from "../lib/mailer";

type Result<T> = { ok: true; data: T } | { ok: false; error: string };
const APP_BASE_URL = process.env.APP_BASE_URL ?? "http://localhost:3001";
const TTL_HOURS = 24;

/** Create a fresh token and email the activation link. Called right after a hotel registers. */
export async function sendActivation(hotelId: string): Promise<Result<{ sent: boolean; to?: string }>> {
  if (!hotelId) return { ok: false, error: "hotelId required" };
  try {
    const rows = await prisma.$queryRawUnsafe<any[]>(
      `select name, contact_email, email_verified from "Hotel" where "hotelId" = $1 limit 1`, hotelId);
    const hotel = rows[0];
    if (!hotel) return { ok: false, error: "Hotel not found." };
    if (hotel.email_verified) return { ok: true, data: { sent: false } };
    const to = hotel.contact_email;
    if (!to) return { ok: false, error: "This hotel has no contact email on file." };

    // one live token at a time - older ones stop working
    await prisma.$executeRawUnsafe(`update email_verification_tokens set used = true where hotel_id = $1 and used = false`, hotelId);

    const token = crypto.randomBytes(32).toString("hex");
    const expires = new Date(Date.now() + TTL_HOURS * 3600 * 1000);
    await prisma.$executeRawUnsafe(
      `insert into email_verification_tokens (hotel_id, email, token, expires_at) values ($1,$2,$3,$4)`,
      hotelId, to, token, expires);

    const link = APP_BASE_URL + "/verify-email?token=" + token;
    const mail = await sendVerificationEmail(to, link, hotel.name ?? "your hotel");
    if (!mail.ok) return { ok: false, error: mail.error ?? "Could not send the email." };
    return { ok: true, data: { sent: true, to } };
  } catch (e) { return { ok: false, error: e instanceof Error ? e.message : "failed" }; }
}

/** The guest of honour clicks the link. */
export async function confirmToken(token: string): Promise<Result<{ hotelName: string; alreadyDone: boolean }>> {
  if (!token) return { ok: false, error: "Token required." };
  try {
    const rows = await prisma.$queryRawUnsafe<any[]>(
      `select id, hotel_id, used, expires_at from email_verification_tokens where token = $1 limit 1`, token);
    const t = rows[0];
    if (!t) return { ok: false, error: "This link is not valid." };

    const hotelRows = await prisma.$queryRawUnsafe<any[]>(
      `select name, email_verified from "Hotel" where "hotelId" = $1 limit 1`, t.hotel_id);
    const name = hotelRows[0]?.name ?? "your hotel";
    if (hotelRows[0]?.email_verified) return { ok: true, data: { hotelName: name, alreadyDone: true } };

    if (t.used) return { ok: false, error: "This link has already been used." };
    if (new Date(t.expires_at) < new Date()) return { ok: false, error: "This link has expired. Ask for a new one." };

    await prisma.$executeRawUnsafe(`update "Hotel" set email_verified = true, email_verified_at = now() where "hotelId" = $1`, t.hotel_id);
    await prisma.$executeRawUnsafe(`update email_verification_tokens set used = true where id = $1::uuid`, t.id);
    return { ok: true, data: { hotelName: name, alreadyDone: false } };
  } catch (e) { return { ok: false, error: e instanceof Error ? e.message : "failed" }; }
}

export async function getVerificationStatus(hotelId: string): Promise<Result<{ verified: boolean; email: string | null }>> {
  try {
    const rows = await prisma.$queryRawUnsafe<any[]>(
      `select email_verified, contact_email from "Hotel" where "hotelId" = $1 limit 1`, hotelId);
    if (!rows[0]) return { ok: false, error: "Hotel not found." };
    return { ok: true, data: { verified: !!rows[0].email_verified, email: rows[0].contact_email ?? null } };
  } catch (e) { return { ok: false, error: e instanceof Error ? e.message : "failed" }; }
}
