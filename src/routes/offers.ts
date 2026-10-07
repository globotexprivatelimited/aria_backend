import { Router } from "express";
import { isAdminKey } from "../lib/security";
import { offerReport } from "../upsell/offers";

export const offersRouter = Router();

/** Revenue from suggestions: offered, accepted, declined, the money, by item, and the latest offers. */
offersRouter.get("/api/revenue/offers", async (req, res) => {
  if (!isAdminKey(req.header("x-admin-key"))) return res.status(401).json({ ok: false, error: "unauthorized" });
  const hotelId = String(req.query.hotelId ?? "");
  if (!hotelId) return res.status(400).json({ ok: false, error: "hotelId required" });
  try { return res.json({ ok: true, data: await offerReport(hotelId, Number(req.query.days ?? 30)) }); }
  catch (e) { return res.status(400).json({ ok: false, error: e instanceof Error ? e.message : "failed" }); }
});
