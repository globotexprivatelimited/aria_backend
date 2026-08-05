import { Router } from "express";
import { login, verifyToken, getDepartments, getHotelName } from "../auth/service";

export const authRouter = Router();

// public login: email + password -> JWT
authRouter.post("/api/auth/login", async (req, res) => {
  const { email, password } = req.body ?? {};
  const r = await login(email, password);
  return res.status(r.ok ? 200 : 401).json(r);
});

// validate the bearer token -> return the session user + departments + hotel name
authRouter.get("/api/auth/me", async (req, res) => {
  const auth = req.header("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  const user = verifyToken(token);
  if (!user) return res.status(401).json({ ok: false, error: "invalid token" });
  const [departments, hotelName] = await Promise.all([getDepartments(user.staffUserId), getHotelName(user.hotelId)]);
  return res.json({ ok: true, data: { ...user, departments, hotelName } });
});

// GM/admin sets a staff member's password in OUR auth system (by email), behind admin key
import { prisma as _prisma } from "../db";
import bcrypt2 from "bcryptjs";
authRouter.post("/api/auth/set-password", async (req, res) => {
  const ADMIN_KEY = process.env.ADMIN_API_KEY ?? "dev-admin-key";
  if (req.header("x-admin-key") !== ADMIN_KEY) return res.status(401).json({ ok: false, error: "unauthorized" });
  const { email, password, hotelId } = req.body ?? {};
  if (!email || !password) return res.status(400).json({ ok: false, error: "email, password required" });
  try {
    const hash = await bcrypt2.hash(password, 10);
    // tenant-guard: only set within the same hotel if hotelId provided
    if (hotelId) {
      await _prisma.$executeRawUnsafe(`update staff_users set password_hash = $1 where lower(email) = lower($2) and hotel_id = $3`, hash, email, hotelId);
    } else {
      await _prisma.$executeRawUnsafe(`update staff_users set password_hash = $1 where lower(email) = lower($2)`, hash, email);
    }
    return res.json({ ok: true });
  } catch (e) { return res.status(400).json({ ok: false, error: e instanceof Error ? e.message : "failed" }); }
});
