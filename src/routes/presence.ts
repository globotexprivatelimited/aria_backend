import { consoleCaller } from "../lib/security";
﻿import { Router } from "express";
import { verifyToken } from "../auth/service";
import { touchPresence, getDepartmentPresence } from "../presence/service";
export const presenceRouter = Router();

// staff portal calls this on a timer while open
presenceRouter.post("/api/presence/heartbeat", async (req, res) => {
  const auth = req.header("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  const user = token ? verifyToken(token) : null;
  if (!user) return res.status(401).json({ ok: false });
  await touchPresence(user.staffUserId);
  return res.json({ ok: true });
});

// GM departments page reads who is online
presenceRouter.get("/api/presence/departments", async (req, res) => {
  // a signed-in GM or founder for their own hotel (tenantGuard), or the platform key - this list was open to anyone (item 11)
  if (!consoleCaller(req)) return res.status(401).json({ ok: false, error: "unauthorized" });
  const r = await getDepartmentPresence(String(req.query.hotelId ?? ""));
  return res.status(r.ok ? 200 : 400).json(r);
});
