import { Router } from "express";
import { listMenu, createMenuItem, updateMenuItem, deleteMenuItem, placeOrder, setMenuAvailability } from "../menu/service";

export const menuRouter = Router();
const ADMIN_KEY = process.env.ADMIN_API_KEY ?? "dev-admin-key";
function checkKey(req: import("express").Request): boolean {
  return req.header("x-admin-key") === ADMIN_KEY;
}

// list a hotel's menu (optionally ?dept=)
menuRouter.get("/api/menu", async (req, res) => {
  if (!checkKey(req)) return res.status(401).json({ error: "unauthorized" });
  const hotelId = String(req.query.hotelId ?? "");
  const dept = req.query.dept ? String(req.query.dept) : undefined;
  if (!hotelId) return res.status(400).json({ error: "hotelId required" });
  const r = await listMenu(hotelId, dept);
  return res.status(r.ok ? 200 : 400).json(r);
});

// add an item
menuRouter.post("/api/menu", async (req, res) => {
  if (!checkKey(req)) return res.status(401).json({ error: "unauthorized" });
  const { hotelId, dept, item } = req.body ?? {};
  if (!hotelId || !dept || !item) return res.status(400).json({ error: "hotelId, dept, item required" });
  const r = await createMenuItem(hotelId, dept, item);
  return res.status(r.ok ? 200 : 400).json(r);
});

// update an item (any fields)
menuRouter.patch("/api/menu/:id", async (req, res) => {
  if (!checkKey(req)) return res.status(401).json({ error: "unauthorized" });
  const { hotelId, fields } = req.body ?? {};
  if (!hotelId || !fields) return res.status(400).json({ error: "hotelId, fields required" });
  const r = await updateMenuItem(hotelId, req.params.id, fields);
  return res.status(r.ok ? 200 : 400).json(r);
});

// delete an item
menuRouter.delete("/api/menu/:id", async (req, res) => {
  if (!checkKey(req)) return res.status(401).json({ error: "unauthorized" });
  const hotelId = String(req.query.hotelId ?? "");
  if (!hotelId) return res.status(400).json({ error: "hotelId required" });
  const r = await deleteMenuItem(hotelId, req.params.id);
  return res.status(r.ok ? 200 : 400).json(r);
});

menuRouter.post("/api/menu/patch", async (req, res) => {
  if (!checkKey(req)) return res.status(401).json({ error: "unauthorized" });
  const { hotelId, id, fields } = req.body ?? {};
  if (!hotelId || !id || !fields) return res.status(400).json({ error: "hotelId, id, fields required" });
  const r = await updateMenuItem(hotelId, id, fields);
  return res.status(r.ok ? 200 : 400).json(r);
});

menuRouter.post("/api/menu/delete", async (req, res) => {
  if (!checkKey(req)) return res.status(401).json({ error: "unauthorized" });
  const { hotelId, id } = req.body ?? {};
  if (!hotelId || !id) return res.status(400).json({ error: "hotelId, id required" });
  const r = await deleteMenuItem(hotelId, id);
  return res.status(r.ok ? 200 : 400).json(r);
});

// place an order (atomically decrements stock)
menuRouter.post("/api/menu/order", async (req, res) => {
  if (!checkKey(req)) return res.status(401).json({ error: "unauthorized" });
  const { hotelId, dept, room, guestPhone, items } = req.body ?? {};
  if (!hotelId || !dept || !items) return res.status(400).json({ error: "hotelId, dept, items required" });
  const r = await placeOrder(hotelId, dept, { room, guestPhone, items });
  return res.status(r.ok ? 200 : 400).json(r);
});

menuRouter.post("/api/menu/availability", async (req, res) => {
  if (!checkKey(req)) return res.status(401).json({ error: "unauthorized" });
  const { hotelId, id, available } = req.body ?? {};
  const r = await setMenuAvailability(hotelId, id, !!available); return res.status(r.ok ? 200 : 400).json(r);
});