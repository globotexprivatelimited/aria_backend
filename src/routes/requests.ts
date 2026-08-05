import { Router } from "express";
import { listActiveRequests, listResolvedRequests, listRequestsSince, listHotelActive, listAllActive, listAllSince, listHotelSince } from "../requests/service";

export const requestsRouter = Router();
const ADMIN_KEY = process.env.ADMIN_API_KEY ?? "dev-admin-key";
function checkKey(req: import("express").Request): boolean {
  return req.header("x-admin-key") === ADMIN_KEY;
}
function parseDepts(v: unknown): string[] {
  return String(v ?? "").split(",").map((s) => s.trim()).filter(Boolean);
}

// active board for a staffer's departments
requestsRouter.get("/api/requests/active", async (req, res) => {
  if (!checkKey(req)) return res.status(401).json({ error: "unauthorized" });
  const hotelId = String(req.query.hotelId ?? "");
  const depts = parseDepts(req.query.depts);
  if (!hotelId) return res.status(400).json({ error: "hotelId required" });
  const r = await listActiveRequests(hotelId, depts);
  return res.status(r.ok ? 200 : 400).json(r);
});

requestsRouter.get("/api/requests/history", async (req, res) => {
  if (!checkKey(req)) return res.status(401).json({ error: "unauthorized" });
  const hotelId = String(req.query.hotelId ?? "");
  const depts = parseDepts(req.query.depts);
  if (!hotelId) return res.status(400).json({ error: "hotelId required" });
  const r = await listResolvedRequests(hotelId, depts);
  return res.status(r.ok ? 200 : 400).json(r);
});

requestsRouter.get("/api/requests/analytics", async (req, res) => {
  if (!checkKey(req)) return res.status(401).json({ error: "unauthorized" });
  const hotelId = String(req.query.hotelId ?? "");
  const depts = parseDepts(req.query.depts);
  const days = parseInt(String(req.query.days ?? "7")) || 7;
  if (!hotelId) return res.status(400).json({ error: "hotelId required" });
  const r = await listRequestsSince(hotelId, depts, days);
  return res.status(r.ok ? 200 : 400).json(r);
});

// GM overview: all active for a hotel
requestsRouter.get("/api/requests/hotel-active", async (req, res) => {
  if (!checkKey(req)) return res.status(401).json({ error: "unauthorized" });
  const hotelId = String(req.query.hotelId ?? "");
  if (!hotelId) return res.status(400).json({ error: "hotelId required" });
  const r = await listHotelActive(hotelId);
  return res.status(r.ok ? 200 : 400).json(r);
});

// FOUNDER: all active across every hotel
requestsRouter.get("/api/requests/all-active", async (req, res) => {
  if (!checkKey(req)) return res.status(401).json({ error: "unauthorized" });
  const r = await listAllActive();
  return res.status(r.ok ? 200 : 400).json(r);
});

// FOUNDER: all requests in last N days across every hotel
requestsRouter.get("/api/requests/all-since", async (req, res) => {
  if (!checkKey(req)) return res.status(401).json({ error: "unauthorized" });
  const days = parseInt(String(req.query.days ?? "30")) || 30;
  const r = await listAllSince(days);
  return res.status(r.ok ? 200 : 400).json(r);
});

// GM dashboard time-series: one hotel, last N days
requestsRouter.get("/api/requests/hotel-since", async (req, res) => {
  if (!checkKey(req)) return res.status(401).json({ error: "unauthorized" });
  const hotelId = String(req.query.hotelId ?? "");
  const days = parseInt(String(req.query.days ?? "7")) || 7;
  if (!hotelId) return res.status(400).json({ error: "hotelId required" });
  const r = await listHotelSince(hotelId, days);
  return res.status(r.ok ? 200 : 400).json(r);
});