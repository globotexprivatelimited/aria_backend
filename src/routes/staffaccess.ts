import { Router } from "express";
import { getStaffAccess, setStaffDeptAccess } from "../staffaccess/service";
export const staffAccessRouter = Router();
const ADMIN_KEY = process.env.ADMIN_API_KEY ?? "dev-admin-key";
function checkKey(req: import("express").Request): boolean { return req.header("x-admin-key") === ADMIN_KEY; }

staffAccessRouter.get("/api/staff-access", async (req, res) => {
  if (!checkKey(req)) return res.status(401).json({ error: "unauthorized" });
  const r = await getStaffAccess(String(req.query.hotelId ?? "")); return res.status(r.ok ? 200 : 400).json(r);
});
staffAccessRouter.post("/api/staff-access/set", async (req, res) => {
  if (!checkKey(req)) return res.status(401).json({ error: "unauthorized" });
  const { hotelId, staffId, dept, active } = req.body ?? {};
  const r = await setStaffDeptAccess(hotelId, staffId, dept, !!active);
  return res.status(r.ok ? 200 : 400).json(r);
});