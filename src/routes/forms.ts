import { Router } from "express";
import { consoleCaller } from "../lib/security";
import { staffNameOf } from "../lib/who";
import { getProfile, setProfile, getSpaRules, setSpaRules, checkSpaRules, listServices, addService, updateService, deleteService, goLiveCheck, goLive, MANDATORY, type ProfileInput, type SpaRulesInput, type ServiceInput } from "../knowledge/forms";

export const formsRouter = Router();
const authed = (req: import("express").Request): boolean => consoleCaller(req);
const fail = (res: import("express").Response, e: unknown) => res.status(400).json({ ok: false, error: e instanceof Error ? e.message : "failed" });
const hotelOf = (req: import("express").Request): string => String(req.query.hotelId ?? (req.body ?? {}).hotelId ?? "");

/** Form 1 - hotel essentials as structured fields. */
formsRouter.get("/api/forms/profile", async (req, res) => {
  if (!authed(req)) return res.status(401).json({ ok: false, error: "unauthorized" });
  const hotelId = hotelOf(req);
  if (!hotelId) return res.status(400).json({ ok: false, error: "hotelId required" });
  try { return res.json({ ok: true, data: await getProfile(hotelId), mandatory: MANDATORY }); } catch (e) { return fail(res, e); }
});
formsRouter.post("/api/forms/profile", async (req, res) => {
  if (!authed(req)) return res.status(401).json({ ok: false, error: "unauthorized" });
  const { hotelId, ...input } = (req.body ?? {}) as { hotelId?: string } & ProfileInput;
  if (!hotelId) return res.status(400).json({ ok: false, error: "hotelId required" });
  try { return res.json({ ok: true, data: await setProfile(String(hotelId), input, staffNameOf(req) || "staff") }); } catch (e) { return fail(res, e); }
});

/** Form 4 - spa rules. */
formsRouter.get("/api/forms/spa", async (req, res) => {
  if (!authed(req)) return res.status(401).json({ ok: false, error: "unauthorized" });
  const hotelId = hotelOf(req);
  if (!hotelId) return res.status(400).json({ ok: false, error: "hotelId required" });
  try { return res.json({ ok: true, data: await getSpaRules(hotelId) }); } catch (e) { return fail(res, e); }
});
formsRouter.post("/api/forms/spa", async (req, res) => {
  if (!authed(req)) return res.status(401).json({ ok: false, error: "unauthorized" });
  const { hotelId, ...input } = (req.body ?? {}) as { hotelId?: string } & SpaRulesInput;
  if (!hotelId) return res.status(400).json({ ok: false, error: "hotelId required" });
  const bad = checkSpaRules(input);
  if (bad) return res.status(400).json({ ok: false, error: bad });
  try { return res.json({ ok: true, data: await setSpaRules(String(hotelId), input, staffNameOf(req) || "staff") }); } catch (e) { return fail(res, e); }
});

/** Form 5 - services and prices. */
formsRouter.get("/api/forms/services", async (req, res) => {
  if (!authed(req)) return res.status(401).json({ ok: false, error: "unauthorized" });
  const hotelId = hotelOf(req);
  if (!hotelId) return res.status(400).json({ ok: false, error: "hotelId required" });
  try { return res.json({ ok: true, data: await listServices(hotelId) }); } catch (e) { return fail(res, e); }
});
formsRouter.post("/api/forms/services", async (req, res) => {
  if (!authed(req)) return res.status(401).json({ ok: false, error: "unauthorized" });
  const { hotelId, ...s } = (req.body ?? {}) as { hotelId?: string } & ServiceInput;
  if (!hotelId || !(s.name ?? "").trim()) return res.status(400).json({ ok: false, error: "hotelId and name required" });
  try { return res.json({ ok: true, data: await addService(String(hotelId), s, staffNameOf(req) || "staff") }); } catch (e) { return fail(res, e); }
});
formsRouter.post("/api/forms/services/update", async (req, res) => {
  if (!authed(req)) return res.status(401).json({ ok: false, error: "unauthorized" });
  const { hotelId, id, ...patch } = (req.body ?? {}) as { hotelId?: string; id?: string } & ServiceInput;
  if (!hotelId || !id) return res.status(400).json({ ok: false, error: "hotelId and id required" });
  try { const r = await updateService(String(hotelId), String(id), patch, staffNameOf(req) || "staff"); return r ? res.json({ ok: true, data: r }) : res.status(404).json({ ok: false, error: "no such service" }); } catch (e) { return fail(res, e); }
});
formsRouter.post("/api/forms/services/delete", async (req, res) => {
  if (!authed(req)) return res.status(401).json({ ok: false, error: "unauthorized" });
  const { hotelId, id } = (req.body ?? {}) as { hotelId?: string; id?: string };
  if (!hotelId || !id) return res.status(400).json({ ok: false, error: "hotelId and id required" });
  try { return res.json({ ok: await deleteService(String(hotelId), String(id)) }); } catch (e) { return fail(res, e); }
});

/** Go-live: what is missing, and the switch - refused while a mandatory field is empty. */
formsRouter.get("/api/forms/go-live", async (req, res) => {
  if (!authed(req)) return res.status(401).json({ ok: false, error: "unauthorized" });
  const hotelId = hotelOf(req);
  if (!hotelId) return res.status(400).json({ ok: false, error: "hotelId required" });
  try { return res.json({ ok: true, data: await goLiveCheck(hotelId) }); } catch (e) { return fail(res, e); }
});
formsRouter.post("/api/forms/go-live", async (req, res) => {
  if (!authed(req)) return res.status(401).json({ ok: false, error: "unauthorized" });
  const hotelId = hotelOf(req);
  if (!hotelId) return res.status(400).json({ ok: false, error: "hotelId required" });
  try { const r = await goLive(hotelId, staffNameOf(req) || "staff"); return res.status(r.ok ? 200 : 409).json({ ok: r.ok, error: r.error, data: r.check }); } catch (e) { return fail(res, e); }
});
