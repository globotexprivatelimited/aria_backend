import { createHmac, timingSafeEqual } from "crypto";
import type { Request, Response, NextFunction } from "express";
import { verifyToken, type SessionUser } from "../auth/service";

/**
 * Security helpers introduced by the Phase 1 retest fixes.
 *  - verifyMetaSignature: HMAC check for X-Hub-Signature-256 on the Meta webhook (D-001)
 *  - isPlaceholderSecret: refuse well-known dev placeholders in production (D-012, D-023)
 *  - validatePassword: a minimum password policy for staff logins (D-032)
 *  - tenantGuard: a JWT-bearing caller may only touch their own hotel (D-005)
 */

/** True when the header is a valid sha256 HMAC of the raw body under the app secret. */
export function verifyMetaSignature(rawBody: Buffer | string | undefined, header: string | undefined, appSecret: string): boolean {
  if (!appSecret || !header || !rawBody) return false;
  const [scheme, given] = header.split("=");
  if (scheme !== "sha256" || !given) return false;
  const expected = createHmac("sha256", appSecret).update(rawBody).digest("hex");
  const a = Buffer.from(given, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

const PLACEHOLDERS = ["dev-secret", "dev-admin-key", "aria_verify", "change-me", "changeme", "secret", "password", "your-token"];

/** Known placeholder or obviously non-random values that must never ship to production. */
export function isPlaceholderSecret(value: string | undefined, minLength = 24): boolean {
  if (!value) return true;
  const v = value.trim().toLowerCase();
  if (v.length < minLength) return true;
  if (PLACEHOLDERS.includes(v)) return true;
  if (/(^|[_-])(dev|test|example|sample|placeholder)([_-]|$)/.test(v)) return true;
  if (/change[_-]?(me|in[_-]?prod)/.test(v)) return true;
  return false;
}

const COMMON_PASSWORDS = ["password", "password1", "12345678", "123456789", "1234567890", "qwerty123", "admin123", "welcome1", "letmein1", "iloveyou"];

/** Returns an error message, or null when the password is acceptable. */
export function validatePassword(password: string | undefined, email?: string): string | null {
  const p = (password ?? "").trim();
  if (p.length < 10) return "Password must be at least 10 characters.";
  if (!/[a-zA-Z]/.test(p) || !/[0-9]/.test(p)) return "Password must contain both letters and numbers.";
  const lower = p.toLowerCase();
  if (COMMON_PASSWORDS.includes(lower)) return "That password is too common.";
  if (email) {
    const e = email.trim().toLowerCase();
    const local = e.split("@")[0] ?? "";
    if (lower === e || (local.length >= 4 && lower.includes(local))) return "Password must not contain your email address.";
  }
  return null;
}

/**
 * When a request carries a Bearer token, the caller is a signed-in staff member and may only
 * act on their own hotel (founders see everything). Requests without a token fall through to
 * whatever guard the route already has (admin key, public login, etc).
 */
export function tenantGuard(req: Request, res: Response, next: NextFunction): void {
  const auth = req.header("authorization") ?? "";
  if (!auth.startsWith("Bearer ")) { next(); return; }
  const user = verifyToken(auth.slice(7));
  if (!user) { res.status(401).json({ ok: false, error: "invalid token" }); return; }
  if (user.role === "founder") { next(); return; }
  const body = (req.body ?? {}) as Record<string, unknown>;
  const params = (req.params ?? {}) as Record<string, string>;
  const asked = String(req.query.hotelId ?? body.hotelId ?? params.hotelId ?? "").trim();
  if (asked && asked !== String(user.hotelId)) {
    res.status(403).json({ ok: false, error: "Not your hotel." });
    return;
  }
  // D-005: the hotel comes from the verified token, never from the client. Fill it in so routes
  // that read hotelId from the query or body get the caller's own hotel even when none was sent.
  if (!asked) {
    (req.query as Record<string, unknown>).hotelId = String(user.hotelId);
    // Express 5 works req.query out afresh on every read, so the filled-in hotel is also set as the request's own value
    Object.defineProperty(req, "query", { value: { ...(req.query as Record<string, unknown>), hotelId: String(user.hotelId) }, writable: true, configurable: true, enumerable: true });
    if (req.body && typeof req.body === "object") (req.body as Record<string, unknown>).hotelId = String(user.hotelId);
  }
  next();
}

/** Constant-time string comparison - a wrong key takes exactly as long to reject as a nearly-right one. */
export function safeEqual(a: unknown, b: unknown): boolean {
  if (typeof a !== "string" || typeof b !== "string" || !a || !b) return false;
  const x = Buffer.from(a), y = Buffer.from(b);
  if (x.length !== y.length) { timingSafeEqual(x, x); return false; }
  return timingSafeEqual(x, y);
}

/** The platform key - or, during a rotation, the previous one (ADMIN_API_KEY_PREVIOUS), so callers can be moved over one at a time. */
export function isAdminKey(given: unknown): boolean {
  const current = process.env.ADMIN_API_KEY, previous = process.env.ADMIN_API_KEY_PREVIOUS;
  if (!current) return false;
  return safeEqual(given, current) || (!!previous && safeEqual(given, previous));
}

/* ---- who may call the hotel-management routes (pending item 11) ---- */

/** Roles that run a hotel from the console. */
export const MANAGER_ROLES = ["gm", "founder"];
/** The reception desk as well as managers - check-in, check-out, the room board. */
export const FRONT_DESK_ROLES = ["gm", "founder", "front_desk"];
/** Everyone who works at a hotel - for what the staff board itself reads. */
export const ANY_HOTEL_ROLE = ["gm", "founder", "front_desk", "fb", "housekeeping", "spa", "staff"];

/** Who signed in, from a verified Bearer token - null without one or with a forged one. */
export function sessionOf(req: Request): SessionUser | null {
  const auth = req.header("authorization") ?? "";
  return auth.startsWith("Bearer ") ? verifyToken(auth.slice(7)) : null;
}

/**
 * The console's way in: a signed-in person with one of these roles - tenantGuard has already held them to their own
 * hotel, founders excepted - or, for scripts and scheduled jobs, the platform key. A role not listed is refused, so a
 * housekeeper's sign-in no longer opens the manager's routes.
 */
export function consoleCaller(req: Request, roles: string[] = MANAGER_ROLES): boolean {
  if (isAdminKey(req.header("x-admin-key"))) return true;
  const user = sessionOf(req);
  return !!user && roles.includes(String(user.role));
}

/** Routes that see or change every hotel: a founder's sign-in or the platform key, nobody else. */
export function founderCaller(req: Request): boolean {
  return consoleCaller(req, ["founder"]);
}
