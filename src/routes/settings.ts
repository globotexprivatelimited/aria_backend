import { Router } from "express";
import { isAdminKey } from "../lib/security";
import { staffNameOf } from "../lib/who";
import { hotelHours, setHotelHours, hoursForApi, listDeptHours, setDeptHours, deleteDeptHours, checkDeptHours, DEPARTMENTS, type HoursInput, type DeptHoursInput } from "../settings/service";

export const settingsRouter = Router();
const authed = (req: import("express").Request): boolean => isAdminKey(req.header("x-admin-key"));
const fail = (res: import("express").Response, e: unknown) => res.status(400).json({ ok: false, error: e instanceof Error ? e.message : "failed" });

/** Quiet hours, the evening nudge window, how often an upsell may be offered. */
settingsRouter.get("/api/settings/hours", async (req, res) => {
  if (!authed(req)) return res.status(401).json({ ok: false, error: "unauthorized" });
  const hotelId = String(req.query.hotelId ?? "");
  if (!hotelId) return res.status(400).json({ ok: false, error: "hotelId required" });
  try { return res.json({ ok: true, data: hoursForApi(await hotelHours(hotelId)) }); } catch (e) { return fail(res, e); }
});
settingsRouter.post("/api/settings/hours", async (req, res) => {
  if (!authed(req)) return res.status(401).json({ ok: false, error: "unauthorized" });
  const { hotelId, ...input } = (req.body ?? {}) as { hotelId?: string } & HoursInput;
  if (!hotelId) return res.status(400).json({ ok: false, error: "hotelId required" });
  try {
    const r = await setHotelHours(String(hotelId), input, staffNameOf(req) || "staff");
    return r.ok ? res.json({ ok: true, data: hoursForApi(r.data) }) : res.status(400).json({ ok: false, error: r.error });
  } catch (e) { return fail(res, e); }
});

/** Department hours - open, close, weekend override, closed days, what to say out of hours. */
settingsRouter.get("/api/settings/dept-hours", async (req, res) => {
  if (!authed(req)) return res.status(401).json({ ok: false, error: "unauthorized" });
  const hotelId = String(req.query.hotelId ?? "");
  if (!hotelId) return res.status(400).json({ ok: false, error: "hotelId required" });
  try { return res.json({ ok: true, data: await listDeptHours(hotelId), departments: DEPARTMENTS }); } catch (e) { return fail(res, e); }
});
settingsRouter.post("/api/settings/dept-hours", async (req, res) => {
  if (!authed(req)) return res.status(401).json({ ok: false, error: "unauthorized" });
  const { hotelId, ...d } = (req.body ?? {}) as { hotelId?: string } & DeptHoursInput;
  if (!hotelId) return res.status(400).json({ ok: false, error: "hotelId required" });
  const bad = checkDeptHours(d);
  if (bad) return res.status(400).json({ ok: false, error: bad });
  try { return res.json({ ok: true, data: await setDeptHours(String(hotelId), d, staffNameOf(req) || "staff") }); } catch (e) { return fail(res, e); }
});
settingsRouter.post("/api/settings/dept-hours/delete", async (req, res) => {
  if (!authed(req)) return res.status(401).json({ ok: false, error: "unauthorized" });
  const { hotelId, dept } = (req.body ?? {}) as { hotelId?: string; dept?: string };
  if (!hotelId || !dept) return res.status(400).json({ ok: false, error: "hotelId and dept required" });
  try { return res.json({ ok: await deleteDeptHours(String(hotelId), String(dept)) }); } catch (e) { return fail(res, e); }
});
