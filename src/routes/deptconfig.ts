import { Router } from "express";
import { getDeptModes, setDeptMode, type DeptMode } from "../deptconfig/service";
export const deptConfigRouter = Router();
const ADMIN_KEY = process.env.ADMIN_API_KEY ?? "dev-admin-key";
function checkKey(req: import("express").Request): boolean { return req.header("x-admin-key") === ADMIN_KEY; }

deptConfigRouter.get("/api/dept-config", async (req, res) => {
  if (!checkKey(req)) return res.status(401).json({ ok: false, error: "unauthorized" });
  try {
    const data = await getDeptModes(String(req.query.hotelId ?? ""));
    return res.json({ ok: true, data });
  } catch (e) { return res.status(400).json({ ok: false, error: e instanceof Error ? e.message : "failed" }); }
});

deptConfigRouter.post("/api/dept-config/set", async (req, res) => {
  if (!checkKey(req)) return res.status(401).json({ ok: false, error: "unauthorized" });
  const { hotelId, dept, mode } = req.body ?? {};
  const r = await setDeptMode(String(hotelId ?? ""), String(dept ?? ""), mode as DeptMode);
  return res.status(r.ok ? 200 : 400).json(r);
});
