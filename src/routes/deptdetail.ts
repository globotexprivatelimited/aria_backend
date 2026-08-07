import { Router } from "express";
import { getDepartmentDetail } from "../deptdetail/service";
export const deptDetailRouter = Router();
const ADMIN_KEY = process.env.ADMIN_API_KEY ?? "dev-admin-key";
function checkKey(req: import("express").Request): boolean { return req.header("x-admin-key") === ADMIN_KEY; }

deptDetailRouter.get("/api/requests/department-detail", async (req, res) => {
  if (!checkKey(req)) return res.status(401).json({ ok: false, error: "unauthorized" });
  const r = await getDepartmentDetail(String(req.query.hotelId ?? ""), String(req.query.dept ?? ""));
  return res.status(r.ok ? 200 : 400).json(r);
});
