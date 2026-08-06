import { Router } from "express";
import { createGM, createHotel, setDepartments } from "../onboarding/service";

export const registerRouter = Router();

// naive in-memory rate limit: max 5 registrations per IP per hour (swap for Redis at scale)
const attempts = new Map<string, { count: number; resetAt: number }>();
function rateLimited(ip: string): boolean {
  const now = Date.now();
  const rec = attempts.get(ip);
  if (!rec || now > rec.resetAt) { attempts.set(ip, { count: 1, resetAt: now + 3600_000 }); return false; }
  rec.count += 1;
  return rec.count > 100;
}

function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "hotel";
}

// Public GM self-registration: creates the GM login + hotel + departments in one call.
registerRouter.post("/api/register", async (req, res) => {
  const ip = (req.headers["x-forwarded-for"] as string) ?? req.socket.remoteAddress ?? "unknown";
  if (rateLimited(ip)) return res.status(429).json({ ok: false, error: "Too many attempts. Please try again later." });

  const {
    fullName, email, password, phone,
    hotelName, address, city, roomCount, checkInTime, checkOutTime, contactPhone,
    departments,
  } = req.body ?? {};

  // validation
  if (!fullName || !email || !password) return res.status(400).json({ ok: false, error: "Your name, email and password are required." });
  if (String(password).length < 8) return res.status(400).json({ ok: false, error: "Password must be at least 8 characters." });
  if (!hotelName) return res.status(400).json({ ok: false, error: "Hotel name is required." });
  if (!Array.isArray(departments) || departments.length === 0) return res.status(400).json({ ok: false, error: "Please select at least one department." });

  // 1. create the GM login
  const gm = await createGM(email, password, fullName, phone);
  if (!gm.ok) return res.status(400).json({ ok: false, error: gm.error });
  const gmAuthUserId = gm.data.authUserId;

  // 2. create the hotel (unique id from the name + a short suffix)
  const hotel = await createHotel(gmAuthUserId, {
    name: hotelName, address, city,
    roomCount: roomCount ? Number(roomCount) : undefined,
    checkInTime, checkOutTime, contactPhone,
  });
  if (!hotel.ok) return res.status(400).json({ ok: false, error: hotel.error });
  const hotelId = hotel.data.hotelId;

  // 3. set the departments the hotel runs
  const depts = await setDepartments(hotelId, departments.map((d: { dept: string; staffNumber?: string }) => ({ dept: d.dept, staffNumber: d.staffNumber })));
  if (!depts.ok) return res.status(400).json({ ok: false, error: depts.error });

  return res.status(200).json({ ok: true, data: { hotelId, email } });
});