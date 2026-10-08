import { Router } from "express";
import { founderCaller } from "../lib/security";
import { usageReport } from "../lib/aiUsage";

export const aiUsageRouter = Router();

/** GET /api/founder/ai-usage?days=30 - what Claude cost, per hotel, per purpose and per day (pending item 18). A founder or the platform key. */
aiUsageRouter.get("/api/founder/ai-usage", async (req, res) => {
  if (!founderCaller(req)) return res.status(401).json({ ok: false, error: "unauthorized" });
  try { return res.json({ ok: true, data: await usageReport(Number(req.query.days ?? 30)) }); }
  catch (e) { return res.status(500).json({ ok: false, error: e instanceof Error ? e.message : "failed" }); }
});
