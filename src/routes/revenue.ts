import { Router } from "express";
import { revenueSummary, revenueByChannel, revenueTimeseries, topItems, revenueByDept, revenueByHour, revenueByRoom } from "../revenue/service";

export const revenueRouter = Router();
const ADMIN_KEY = process.env.ADMIN_API_KEY ?? "dev-admin-key";
function checkKey(req: import("express").Request): boolean { return req.header("x-admin-key") === ADMIN_KEY; }

revenueRouter.get("/api/revenue/summary", async (req, res) => {
  if (!checkKey(req)) return res.status(401).json({ error: "unauthorized" });
  const r = await revenueSummary(String(req.query.hotelId ?? ""));
  return res.status(r.ok ? 200 : 400).json(r);
});
revenueRouter.get("/api/revenue/by-channel", async (req, res) => {
  if (!checkKey(req)) return res.status(401).json({ error: "unauthorized" });
  const r = await revenueByChannel(String(req.query.hotelId ?? ""));
  return res.status(r.ok ? 200 : 400).json(r);
});
revenueRouter.get("/api/revenue/timeseries", async (req, res) => {
  if (!checkKey(req)) return res.status(401).json({ error: "unauthorized" });
  const days = parseInt(String(req.query.days ?? "30")) || 30;
  const r = await revenueTimeseries(String(req.query.hotelId ?? ""), days);
  return res.status(r.ok ? 200 : 400).json(r);
});
revenueRouter.get("/api/revenue/top-items", async (req, res) => {
  if (!checkKey(req)) return res.status(401).json({ error: "unauthorized" });
  const r = await topItems(String(req.query.hotelId ?? ""));
  return res.status(r.ok ? 200 : 400).json(r);
});

revenueRouter.get("/api/revenue/by-dept", async (req, res) => {
  if (!checkKey(req)) return res.status(401).json({ error: "unauthorized" });
  const r = await revenueByDept(String(req.query.hotelId ?? "")); return res.status(r.ok ? 200 : 400).json(r);
});
revenueRouter.get("/api/revenue/by-hour", async (req, res) => {
  if (!checkKey(req)) return res.status(401).json({ error: "unauthorized" });
  const r = await revenueByHour(String(req.query.hotelId ?? "")); return res.status(r.ok ? 200 : 400).json(r);
});
revenueRouter.get("/api/revenue/by-room", async (req, res) => {
  if (!checkKey(req)) return res.status(401).json({ error: "unauthorized" });
  const r = await revenueByRoom(String(req.query.hotelId ?? "")); return res.status(r.ok ? 200 : 400).json(r);
});