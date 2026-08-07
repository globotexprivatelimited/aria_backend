import { Router } from "express";
import { createGM, createHotel, setDepartments, createStaff, listStaff, resetStaffPassword } from "../onboarding/service";

export const onboardingRouter = Router();

const ADMIN_KEY = process.env.ADMIN_API_KEY ?? "dev-admin-key";
function checkKey(req: import("express").Request): boolean {
  return req.header("x-admin-key") === ADMIN_KEY;
}

// Founder creates a GM login
onboardingRouter.post("/api/admin/gms", async (req, res) => {
  if (!checkKey(req)) return res.status(401).json({ error: "unauthorized" });
  const { email, password, fullName, phone } = req.body ?? {};
  if (!email || !password || !fullName) return res.status(400).json({ error: "email, password, fullName required" });
  const r = await createGM(email, password, fullName, phone);
  return res.status(r.ok ? 200 : 400).json(r);
});

// GM creates / saves their hotel
onboardingRouter.post("/api/hotels", async (req, res) => {
  if (!checkKey(req)) return res.status(401).json({ error: "unauthorized" });
  const { gmAuthUserId, hotelId, name, address, city, roomCount, checkInTime, checkOutTime, contactPhone } = req.body ?? {};
  if (!gmAuthUserId || !hotelId || !name) return res.status(400).json({ error: "gmAuthUserId, hotelId, name required" });
  const r = await createHotel(gmAuthUserId, { name, address, city, roomCount, checkInTime, checkOutTime, contactPhone });
  return res.status(r.ok ? 200 : 400).json(r);
});

// GM sets which departments the hotel runs
onboardingRouter.post("/api/hotels/:hotelId/departments", async (req, res) => {
  if (!checkKey(req)) return res.status(401).json({ error: "unauthorized" });
  const { hotelId } = req.params;
  const { departments } = req.body ?? {};
  if (!Array.isArray(departments) || departments.length === 0) return res.status(400).json({ error: "departments array required" });
  const r = await setDepartments(hotelId, departments);
  return res.status(r.ok ? 200 : 400).json(r);
});

// GM creates a department staff login
onboardingRouter.post("/api/admin/staff", async (req, res) => {
  if (!checkKey(req)) return res.status(401).json({ error: "unauthorized" });
  const { hotelId, departments, email, password, fullName, phone } = req.body ?? {};
  if (!hotelId || !Array.isArray(departments) || departments.length === 0 || !email || !password || !fullName) return res.status(400).json({ error: "hotelId, departments[], email, password, fullName required" });
  const r = await createStaff(hotelId, departments, email, password, fullName, phone);
  return res.status(r.ok ? 200 : 400).json(r);
});

// GM lists their hotel's staff (with departments) - for the Staff page to load on refresh
onboardingRouter.get("/api/admin/staff", async (req, res) => {
  if (req.header("x-admin-key") !== (process.env.ADMIN_API_KEY ?? "dev-admin-key")) return res.status(401).json({ error: "unauthorized" });
  const hotelId = String(req.query.hotelId ?? "");
  if (!hotelId) return res.status(400).json({ error: "hotelId required" });
  const r = await listStaff(hotelId);
  return res.status(r.ok ? 200 : 400).json(r);
});

// GM resets a staff member's password
onboardingRouter.post("/api/admin/staff/reset-password", async (req, res) => {
  if (req.header("x-admin-key") !== (process.env.ADMIN_API_KEY ?? "dev-admin-key")) return res.status(401).json({ error: "unauthorized" });
  const { hotelId, staffId, newPassword } = req.body ?? {};
  if (!hotelId || !staffId || !newPassword) return res.status(400).json({ error: "hotelId, staffId, newPassword required" });
  const r = await resetStaffPassword(hotelId, staffId, newPassword);
  return res.status(r.ok ? 200 : 400).json(r);
});
