import { Router } from "express";
import { log } from "../lib/logger";
export const aisensyProbeRouter = Router();

/** Temporary: logs whatever AiSensy posts so we can see the real payload shape. */
aisensyProbeRouter.post("/webhooks/aisensy-probe", async (req, res) => {
  res.status(200).json({ ok: true });
  log.info("AISENSY PROBE", { body: JSON.stringify(req.body).slice(0, 2000) });
  console.log("=== AISENSY RAW PAYLOAD ===");
  console.log(JSON.stringify(req.body, null, 2));
});
