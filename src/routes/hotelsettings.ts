import { Router, type Request, type Response, type NextFunction } from "express";
import { prisma } from "../db";
import { log } from "../lib/logger";

/**
 * Hotel-level settings a GM controls from the dashboard.
 * D-052 / D-058: emergency mode was only reachable through the legacy WATI admin webhook. This gives the
 * dashboard a real toggle. The tenant guard (src/lib/security.ts) already stops a signed-in GM from
 * touching another hotel; the admin key covers the dashboard's server-to-server calls.
 */
export const hotelSettingsRouter = Router();

function requireAdmin(req: Request, res: Response, next: NextFunction) {
  const key = process.env.ADMIN_API_KEY ?? "";
  if (!key || req.header("x-admin-key") !== key) {
    res.status(401).json({ ok: false, error: "unauthorized" });
    return;
  }
  next();
}

hotelSettingsRouter.get("/api/hotel/settings", requireAdmin, async (req, res) => {
  const hotelId = String(req.query.hotelId ?? "");
  if (!hotelId) return res.status(400).json({ ok: false, error: "hotelId required" });
  const rows = await prisma.$queryRawUnsafe<any[]>(
    `select "hotelId", name, "emergencyMode", "checkInTime", "checkOutTime", timezone from "Hotel" where "hotelId" = $1`, hotelId);
  if (!rows[0]) return res.status(404).json({ ok: false, error: "hotel not found" });
  return res.json({ ok: true, data: rows[0] });
});

/** Turn hotel-wide emergency mode on or off. While on, every guest message gets the emergency notice and the AI is skipped. */
hotelSettingsRouter.post("/api/hotel/emergency-mode", requireAdmin, async (req, res) => {
  const { hotelId, enabled, by } = req.body ?? {};
  if (!hotelId || typeof enabled !== "boolean") return res.status(400).json({ ok: false, error: "hotelId and enabled (true/false) required" });
  const rows = await prisma.$queryRawUnsafe<any[]>(
    `update "Hotel" set "emergencyMode" = $2 where "hotelId" = $1 returning "hotelId", "emergencyMode"`, String(hotelId), enabled);
  if (!rows[0]) return res.status(404).json({ ok: false, error: "hotel not found" });
  log.warn("emergency mode " + (enabled ? "ON" : "OFF"), { hotelId: String(hotelId), by: String(by ?? "dashboard") });
  return res.json({ ok: true, data: rows[0] });
});
