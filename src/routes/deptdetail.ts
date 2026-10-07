import { isAdminKey } from "../lib/security";
﻿import { Router } from "express";
import { getDepartmentDetail } from "../deptdetail/service";
export const deptDetailRouter = Router();
function checkKey(req: import("express").Request): boolean { return isAdminKey(req.header("x-admin-key")); }

deptDetailRouter.get("/api/requests/department-detail", async (req, res) => {
  if (!checkKey(req)) return res.status(401).json({ ok: false, error: "unauthorized" });
  const r = await getDepartmentDetail(String(req.query.hotelId ?? ""), String(req.query.dept ?? ""));
  return res.status(r.ok ? 200 : 400).json(r);
});
