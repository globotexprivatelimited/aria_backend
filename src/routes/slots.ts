import { Router } from "express";
import { listSlotsLegacy as listSlots, createSlot, updateSlotLegacy as updateSlot, deleteSlotLegacy as deleteSlot } from "../slots/service";

export const slotsRouter = Router();
const ADMIN_KEY = process.env.ADMIN_API_KEY ?? "dev-admin-key";
function checkKey(req: import("express").Request): boolean {
  return req.header("x-admin-key") === ADMIN_KEY;
}

slotsRouter.get("/api/slots", async (req, res) => {
  if (!checkKey(req)) return res.status(401).json({ error: "unauthorized" });
  const hotelId = String(req.query.hotelId ?? "");
  const dept = req.query.dept ? String(req.query.dept) : undefined;
  if (!hotelId) return res.status(400).json({ error: "hotelId required" });
  const r = await listSlots(hotelId, dept);
  return res.status(r.ok ? 200 : 400).json(r);
});

slotsRouter.post("/api/slots", async (req, res) => {
  if (!checkKey(req)) return res.status(401).json({ error: "unauthorized" });
  const { hotelId, dept, slot } = req.body ?? {};
  if (!hotelId || !dept || !slot) return res.status(400).json({ error: "hotelId, dept, slot required" });
  const r = await createSlot(hotelId, dept, slot);
  return res.status(r.ok ? 200 : 400).json(r);
});

slotsRouter.post("/api/slots/patch", async (req, res) => {
  if (!checkKey(req)) return res.status(401).json({ error: "unauthorized" });
  const { hotelId, id, fields } = req.body ?? {};
  if (!hotelId || !id || !fields) return res.status(400).json({ error: "hotelId, id, fields required" });
  const r = await updateSlot(hotelId, id, fields);
  return res.status(r.ok ? 200 : 400).json(r);
});

slotsRouter.post("/api/slots/delete", async (req, res) => {
  if (!checkKey(req)) return res.status(401).json({ error: "unauthorized" });
  const { hotelId, id } = req.body ?? {};
  if (!hotelId || !id) return res.status(400).json({ error: "hotelId, id required" });
  const r = await deleteSlot(hotelId, id);
  return res.status(r.ok ? 200 : 400).json(r);
});