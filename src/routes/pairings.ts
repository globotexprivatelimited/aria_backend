import { Router } from "express";
import { consoleCaller } from "../lib/security";
import { staffNameOf } from "../lib/who";
import { listPairings, setPairing, deletePairing, type PairingInput } from "../menu/pairings";

export const pairingsRouter = Router();
const authed = (req: import("express").Request): boolean => consoleCaller(req);
const fail = (res: import("express").Response, e: unknown) => res.status(400).json({ ok: false, error: e instanceof Error ? e.message : "failed" });

pairingsRouter.get("/api/menu/pairings", async (req, res) => {
  if (!authed(req)) return res.status(401).json({ ok: false, error: "unauthorized" });
  try { return res.json({ ok: true, data: await listPairings(String(req.query.hotelId ?? "")) }); } catch (e) { return fail(res, e); }
});
pairingsRouter.post("/api/menu/pairings", async (req, res) => {
  if (!authed(req)) return res.status(401).json({ ok: false, error: "unauthorized" });
  const { hotelId, ...p } = (req.body ?? {}) as { hotelId?: string } & PairingInput;
  if (!hotelId || !p.itemId || !p.itemName) return res.status(400).json({ ok: false, error: "hotelId, itemId and itemName required" });
  try { return res.json({ ok: true, data: await setPairing(String(hotelId), p, staffNameOf(req) || "staff") }); } catch (e) { return fail(res, e); }
});
pairingsRouter.post("/api/menu/pairings/delete", async (req, res) => {
  if (!authed(req)) return res.status(401).json({ ok: false, error: "unauthorized" });
  const { hotelId, itemId } = (req.body ?? {}) as { hotelId?: string; itemId?: string };
  if (!hotelId || !itemId) return res.status(400).json({ ok: false, error: "hotelId and itemId required" });
  try { return res.json({ ok: await deletePairing(String(hotelId), String(itemId)) }); } catch (e) { return fail(res, e); }
});
