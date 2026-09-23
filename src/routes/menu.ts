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
/** Checks the numbers a GM can edit and normalises "23" to 23. Returns a reason when something is wrong, so nothing half-valid is saved. */
export function checkMenuFields(fields: Record<string, unknown>): string | null {
  const whole = (key: string, label: string): string | null => {
    if (fields[key] === undefined) return null;
    const n = typeof fields[key] === "string" && String(fields[key]).trim() !== "" ? Number(fields[key]) : fields[key];
    if (typeof n !== "number" || !Number.isInteger(n) || n < 0 || n > 9999) return label + " must be a whole number from 0 to 9999";
    fields[key] = n; return null;
  };
  const stock = whole("stock", "Stock"); if (stock) return stock;
  const low = whole("low_stock_at", "Low-stock level"); if (low) return low;
  if (fields.price !== undefined) {
    const n = typeof fields.price === "string" && String(fields.price).trim() !== "" ? Number(fields.price) : fields.price;
    if (typeof n !== "number" || !Number.isFinite(n) || n < 0 || n > 1000000) return "Price must be a number of 0 or more";
    fields.price = Math.round(n * 100) / 100;
  }
  return null;
}
menuRouter.patch("/api/menu/:id", async (req, res) => {
  if (!checkKey(req)) return res.status(401).json({ error: "unauthorized" });
  const { hotelId, fields } = req.body ?? {};
  if (!hotelId || !fields) return res.status(400).json({ error: "hotelId, fields required" });
  if (typeof fields !== "object") return res.status(400).json({ ok: false, error: "fields must be an object" });
  const bad = checkMenuFields(fields); if (bad) return res.status(400).json({ ok: false, error: bad });
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
  if (typeof fields !== "object") return res.status(400).json({ ok: false, error: "fields must be an object" });
  const bad = checkMenuFields(fields); if (bad) return res.status(400).json({ ok: false, error: bad });
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