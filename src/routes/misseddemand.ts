import { Router } from "express";
import { getMissedDemand, markAddressed } from "../misseddemand/service";
export const missedDemandRouter = Router();
const ADMIN_KEY = process.env.ADMIN_API_KEY ?? "dev-admin-key";
function checkKey(req: import("express").Request): boolean { return req.header("x-admin-key") === ADMIN_KEY; }

missedDemandRouter.get("/api/revenue/missed", async (req, res) => {
  if (!checkKey(req)) return res.status(401).json({ ok: false, error: "unauthorized" });
  const days = Number(req.query.days ?? 30);
  const r = await getMissedDemand(String(req.query.hotelId ?? ""), isNaN(days) ? 30 : days);
  return res.status(r.ok ? 200 : 400).json(r);
});

missedDemandRouter.post("/api/revenue/missed/addressed", async (req, res) => {
  if (!checkKey(req)) return res.status(401).json({ ok: false, error: "unauthorized" });
  const { hotelId, department, item } = req.body ?? {};
  const r = await markAddressed(String(hotelId ?? ""), String(department ?? ""), String(item ?? ""));
  return res.status(r.ok ? 200 : 400).json(r);
});
