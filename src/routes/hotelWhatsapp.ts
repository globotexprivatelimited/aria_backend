import { Router } from "express";
import { isAdminKey } from "../lib/security";
import { verifyToken } from "../auth/service";
import { staffNameOf } from "../lib/who";
import { hotelWhatsApp, connectHotelWhatsApp, disconnectHotelWhatsApp } from "../lib/metaConnect";

export const hotelWhatsappRouter = Router();

/** The founder's session, or the platform key - linking a number to a hotel is a platform action, never a hotel's own. */
function founderOrAdmin(req: import("express").Request): boolean {
  if (isAdminKey(req.header("x-admin-key"))) return true;
  const auth = req.header("authorization") ?? "";
  const user = auth.startsWith("Bearer ") ? (verifyToken(auth.slice(7)) as unknown as { role?: string } | null) : null;
  return !!user && user.role === "founder";
}
const fail = (res: import("express").Response, e: unknown) => res.status(400).json({ ok: false, error: e instanceof Error ? e.message : "failed" });

hotelWhatsappRouter.get("/api/founder/hotels/:hotelId/whatsapp", async (req, res) => {
  if (!founderOrAdmin(req)) return res.status(401).json({ ok: false, error: "unauthorized" });
  try {
    const d = await hotelWhatsApp(String(req.params.hotelId), String(req.query.live ?? "1") !== "0");
    return d ? res.json({ ok: true, data: d }) : res.status(404).json({ ok: false, error: "no such hotel" });
  } catch (e) { return fail(res, e); }
});
hotelWhatsappRouter.post("/api/founder/hotels/:hotelId/whatsapp", async (req, res) => {
  if (!founderOrAdmin(req)) return res.status(401).json({ ok: false, error: "unauthorized" });
  const { phoneNumberId, wabaId } = (req.body ?? {}) as { phoneNumberId?: string; wabaId?: string };
  if (!phoneNumberId) return res.status(400).json({ ok: false, error: "phoneNumberId required" });
  try {
    const r = await connectHotelWhatsApp(String(req.params.hotelId), String(phoneNumberId), wabaId ?? null, staffNameOf(req) || "founder");
    return r.ok ? res.json({ ok: true, data: r.data, subscribed: r.subscribed, note: r.note }) : res.status(400).json({ ok: false, error: r.error });
  } catch (e) { return fail(res, e); }
});
hotelWhatsappRouter.post("/api/founder/hotels/:hotelId/whatsapp/disconnect", async (req, res) => {
  if (!founderOrAdmin(req)) return res.status(401).json({ ok: false, error: "unauthorized" });
  try { return res.json({ ok: await disconnectHotelWhatsApp(String(req.params.hotelId), staffNameOf(req) || "founder") }); } catch (e) { return fail(res, e); }
});
