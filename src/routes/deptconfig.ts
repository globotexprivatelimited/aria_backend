import { verifyToken } from "../auth/service";
﻿import { Router } from "express";
import { getDeptModes, setDeptMode, getDeptModeHistory, type DeptMode } from "../deptconfig/service";
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

deptConfigRouter.get("/api/dept-config/history", async (req, res) => {
  if (!checkKey(req)) return res.status(401).json({ ok: false, error: "unauthorized" });
  try { return res.json({ ok: true, data: await getDeptModeHistory(String(req.query.hotelId ?? "")) }); }
  catch (e) { return res.status(400).json({ ok: false, error: e instanceof Error ? e.message : "failed" }); }
});

deptConfigRouter.post("/api/dept-config/set", async (req, res) => {
  if (!checkKey(req)) return res.status(401).json({ ok: false, error: "unauthorized" });
  const { hotelId, dept, mode, changedBy } = req.body ?? {};
  // the name comes from the verified session token; a name sent by the browser is kept only as a fallback, marked as such
  const auth = req.header("authorization") ?? "";
  const who = auth.startsWith("Bearer ") ? (verifyToken(auth.slice(7)) as unknown as Record<string, unknown> | null) : null;
  const verified = who ? String(who.fullName ?? who.email ?? who.staffUserId ?? "").trim() : "";
  const r = await setDeptMode(String(hotelId ?? ""), String(dept ?? ""), mode as DeptMode, verified || (typeof changedBy === "string" && changedBy.trim() ? changedBy.trim() + " (unverified)" : "staff"));
  return res.status(r.ok ? 200 : 400).json(r);
});
