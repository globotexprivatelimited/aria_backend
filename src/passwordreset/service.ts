import { prisma } from "../db";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import { sendPasswordResetEmail } from "../lib/mailer";

type Result<T> = { ok: true; data: T } | { ok: false; error: string };
const APP_BASE_URL = process.env.APP_BASE_URL ?? "http://localhost:3001";

// GM requests a reset: verify they are a GM, create token, email the hotel contact address
export async function requestReset(email: string): Promise<Result<{ sent: boolean }>> {
  if (!email) return { ok: false, error: "Email required." };
  try {
    // find the user by login email - MUST be role gm
    const users = await prisma.$queryRawUnsafe<any[]>(
      `select id, role, hotel_id from staff_users where lower(email)=lower($1) limit 1`, email.trim());
    const u = users[0];
    // Always respond success-ish to avoid leaking which emails exist, BUT only actually send for GMs
    if (!u || u.role !== "gm") {
      return { ok: true, data: { sent: false } };
    }
    // get the hotel's contact email (where the link goes) + hotel name
    const hotel = await prisma.$queryRawUnsafe<any[]>(
      `select name, contact_email from "Hotel" where "hotelId"=$1 limit 1`, u.hotel_id);
    const contactEmail = hotel[0]?.contact_email;
    const hotelName = hotel[0]?.name ?? "your hotel";
    if (!contactEmail) return { ok: false, error: "No hotel contact email is set. Add one first." };

    // create a secure token, 1 hour expiry
    const token = crypto.randomBytes(32).toString("hex");
    const expires = new Date(Date.now() + 60 * 60 * 1000);
    await prisma.$executeRawUnsafe(
      `insert into password_reset_tokens (staff_user_id, token, expires_at) values ($1::uuid, $2, $3)`,
      u.id, token, expires);

    const resetLink = `${APP_BASE_URL}/reset-password?token=${token}`;
    const mail = await sendPasswordResetEmail(contactEmail, resetLink, hotelName);
    if (!mail.ok) return { ok: false, error: mail.error ?? "Could not send email." };
    return { ok: true, data: { sent: true } };
  } catch (e) { return { ok: false, error: e instanceof Error ? e.message : "Reset request failed." }; }
}

// validate a token (for the reset page to check before showing the form)
export async function validateResetToken(token: string): Promise<Result<{ valid: boolean }>> {
  if (!token) return { ok: false, error: "Token required." };
  try {
    const rows = await prisma.$queryRawUnsafe<any[]>(
      `select id from password_reset_tokens where token=$1 and used=false and expires_at > now() limit 1`, token);
    return { ok: true, data: { valid: !!rows[0] } };
  } catch (e) { return { ok: false, error: e instanceof Error ? e.message : "failed" }; }
}

// set the new password using a valid token
export async function performReset(token: string, newPassword: string): Promise<Result<{ done: boolean }>> {
  if (!token || !newPassword) return { ok: false, error: "Token and new password required." };
  if (newPassword.length < 8) return { ok: false, error: "Password must be at least 8 characters." };
  try {
    const rows = await prisma.$queryRawUnsafe<any[]>(
      `select id, staff_user_id from password_reset_tokens where token=$1 and used=false and expires_at > now() limit 1`, token);
    const t = rows[0];
    if (!t) return { ok: false, error: "This reset link is invalid or has expired." };
    const hash = await bcrypt.hash(newPassword, 10);
    await prisma.$executeRawUnsafe(`update staff_users set password_hash=$1 where id=$2::uuid`, hash, t.staff_user_id);
    await prisma.$executeRawUnsafe(`update password_reset_tokens set used=true where id=$1::uuid`, t.id);
    return { ok: true, data: { done: true } };
  } catch (e) { return { ok: false, error: e instanceof Error ? e.message : "Reset failed." }; }
}
