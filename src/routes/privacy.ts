import { Router, type Request, type Response, type NextFunction } from "express";
import { eraseGuestData, exportGuestData } from "../privacy/erasure";
import { CONSENT_NOTICE, getConsent, recordConsent } from "../privacy/consent";

export const privacyRouter = Router();

function requireAdmin(req: Request, res: Response, next: NextFunction) {
  const key = process.env.ADMIN_API_KEY ?? "";
  if (!key || req.header("x-admin-key") !== key) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  next();
}

privacyRouter.get("/api/privacy/notice", (_req, res) => {
  res.json({ version: "v1", notice: CONSENT_NOTICE });
});

privacyRouter.get("/api/privacy/consent", requireAdmin, async (req, res) => {
  const hotelId = String(req.query.hotelId ?? "demo");
  const phone = String(req.query.phone ?? "");
  if (!phone) { res.status(400).json({ error: "phone required" }); return; }
  const consent = await getConsent(hotelId, phone);
  res.json({ hotelId, phone, consent });
});

privacyRouter.post("/api/privacy/consent", requireAdmin, async (req, res) => {
  const { hotelId, phone, granted } = req.body ?? {};
  if (!hotelId || !phone || typeof granted !== "boolean") {
    res.status(400).json({ error: "hotelId, phone, granted(boolean) required" });
    return;
  }
  const consent = await recordConsent(hotelId, phone, granted);
  res.json({ ok: true, consent });
});

privacyRouter.get("/api/privacy/export", requireAdmin, async (req, res) => {
  const hotelId = String(req.query.hotelId ?? "demo");
  const phone = String(req.query.phone ?? "");
  if (!phone) { res.status(400).json({ error: "phone required" }); return; }
  const data = await exportGuestData(hotelId, phone);
  res.json(data);
});

privacyRouter.post("/api/privacy/erase", requireAdmin, async (req, res) => {
  const { hotelId, phone, requestedBy } = req.body ?? {};
  if (!hotelId || !phone) {
    res.status(400).json({ error: "hotelId and phone required" });
    return;
  }
  const result = await eraseGuestData(hotelId, phone, requestedBy);
  res.json({ ok: true, ...result });
});
