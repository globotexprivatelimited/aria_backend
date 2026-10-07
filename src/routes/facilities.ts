import { Router } from "express";
import { isAdminKey } from "../lib/security";
import { staffNameOf } from "../lib/who";
import { listFacilities, addFacility, updateFacility, deleteFacility, checkFacility, type FacilityInput } from "../facilities/service";

export const facilitiesRouter = Router();
const authed = (req: import("express").Request): boolean => isAdminKey(req.header("x-admin-key"));
const fail = (res: import("express").Response, e: unknown) => res.status(400).json({ ok: false, error: e instanceof Error ? e.message : "failed" });

facilitiesRouter.get("/api/facilities", async (req, res) => {
  if (!authed(req)) return res.status(401).json({ ok: false, error: "unauthorized" });
  try { return res.json({ ok: true, data: await listFacilities(String(req.query.hotelId ?? "")) }); } catch (e) { return fail(res, e); }
});
facilitiesRouter.post("/api/facilities", async (req, res) => {
  if (!authed(req)) return res.status(401).json({ ok: false, error: "unauthorized" });
  const { hotelId, ...f } = (req.body ?? {}) as { hotelId?: string } & FacilityInput;
  if (!hotelId) return res.status(400).json({ ok: false, error: "hotelId required" });
  const bad = checkFacility(f, true); if (bad) return res.status(400).json({ ok: false, error: bad });
  try { return res.json({ ok: true, data: await addFacility(String(hotelId), f, staffNameOf(req) || "staff") }); } catch (e) { return fail(res, e); }
});
facilitiesRouter.post("/api/facilities/update", async (req, res) => {
  if (!authed(req)) return res.status(401).json({ ok: false, error: "unauthorized" });
  const { hotelId, id, ...patch } = (req.body ?? {}) as { hotelId?: string; id?: string } & FacilityInput;
  if (!hotelId || !id) return res.status(400).json({ ok: false, error: "hotelId and id required" });
  const bad = checkFacility(patch, false); if (bad) return res.status(400).json({ ok: false, error: bad });
  try { const row = await updateFacility(String(hotelId), String(id), patch, staffNameOf(req) || "staff"); return row ? res.json({ ok: true, data: row }) : res.status(404).json({ ok: false, error: "not found" }); } catch (e) { return fail(res, e); }
});
facilitiesRouter.post("/api/facilities/delete", async (req, res) => {
  if (!authed(req)) return res.status(401).json({ ok: false, error: "unauthorized" });
  const { hotelId, id } = (req.body ?? {}) as { hotelId?: string; id?: string };
  if (!hotelId || !id) return res.status(400).json({ ok: false, error: "hotelId and id required" });
  try { return res.json({ ok: await deleteFacility(String(hotelId), String(id)) }); } catch (e) { return fail(res, e); }
});
