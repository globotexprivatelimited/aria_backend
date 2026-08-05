import { prisma } from "../db";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";

const JWT_SECRET = process.env.JWT_SECRET ?? "dev-secret";
const TOKEN_TTL = "30d";

type Result<T> = { ok: true; data: T } | { ok: false; error: string };
export type SessionUser = { staffUserId: string; role: string; hotelId: string; fullName: string; email: string };

// set/reset a password hash for a staff_users row (by email lookup in Supabase Auth is gone; we match by staff_users.id or email column)
export async function setPassword(staffUserId: string, plain: string): Promise<Result<{ id: string }>> {
  try {
    const hash = await bcrypt.hash(plain, 10);
    await prisma.$executeRawUnsafe(`update staff_users set password_hash = $1 where id = $2::uuid`, hash, staffUserId);
    return { ok: true, data: { id: staffUserId } };
  } catch (e) { return { ok: false, error: e instanceof Error ? e.message : "Could not set password." }; }
}

// login by email + password. staff_users has full_name, role, hotel_id; email is stored on the row (we add it) OR matched via a passed email column.
export async function login(email: string, password: string): Promise<Result<{ token: string; user: SessionUser }>> {
  if (!email || !password) return { ok: false, error: "Email and password required." };
  try {
    const rows = await prisma.$queryRawUnsafe<any[]>(
      `select id, role, hotel_id, full_name, email, password_hash from staff_users where lower(email) = lower($1) limit 1`, email
    );
    const u = rows[0];
    if (!u || !u.password_hash) return { ok: false, error: "Invalid email or password." };
    const ok = await bcrypt.compare(password, u.password_hash);
    if (!ok) return { ok: false, error: "Invalid email or password." };
    const user: SessionUser = { staffUserId: u.id, role: u.role, hotelId: u.hotel_id, fullName: u.full_name ?? "", email: u.email };
    const token = jwt.sign(user, JWT_SECRET, { expiresIn: TOKEN_TTL });
    return { ok: true, data: { token, user } };
  } catch (e) { return { ok: false, error: e instanceof Error ? e.message : "Login failed." }; }
}

export function verifyToken(token: string): SessionUser | null {
  try { return jwt.verify(token, JWT_SECRET) as SessionUser; } catch { return null; }
}

// departments for a staff user
export async function getDepartments(staffUserId: string): Promise<string[]> {
  try {
    const rows = await prisma.$queryRawUnsafe<any[]>(`select dept from staff_departments where staff_user_id = $1::uuid`, staffUserId);
    return rows.map((r) => r.dept);
  } catch { return []; }
}

// hotel name for the session
export async function getHotelName(hotelId: string): Promise<string> {
  try {
    const rows = await prisma.$queryRawUnsafe<any[]>(`select name from "Hotel" where "hotelId" = $1 limit 1`, hotelId);
    return rows[0]?.name ?? hotelId;
  } catch { return hotelId; }
}