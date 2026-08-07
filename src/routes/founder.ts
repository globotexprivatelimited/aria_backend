import { Router } from "express";
import { verifyToken } from "../auth/service";
import { getPortfolio, getHotelDetail, getAllPeople, getInsights } from "../founder/service";

export const founderRouter = Router();

/** Only a founder sees across hotels. Checked against the session, not a shared key. */
function requireFounder(req: import("express").Request): { ok: boolean; error?: string } {
  const auth = req.header("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  const user = token ? verifyToken(token) : null;
  if (!user) return { ok: false, error: "Not signed in." };
  if (user.role !== "founder") return { ok: false, error: "Founders only." };
  return { ok: true };
}

founderRouter.get("/api/founder/portfolio", async (req, res) => {
  const gate = requireFounder(req);
  if (!gate.ok) return res.status(gate.error === "Not signed in." ? 401 : 403).json({ ok: false, error: gate.error });
  const r = await getPortfolio();
  return res.status(r.ok ? 200 : 400).json(r);
});

founderRouter.get("/api/founder/hotel", async (req, res) => {
  const gate = requireFounder(req);
  if (!gate.ok) return res.status(gate.error === "Not signed in." ? 401 : 403).json({ ok: false, error: gate.error });
  const r = await getHotelDetail(String(req.query.hotelId ?? ""));
  return res.status(r.ok ? 200 : 400).json(r);
});

founderRouter.get("/api/founder/people", async (req, res) => {
  const gate = requireFounder(req);
  if (!gate.ok) return res.status(gate.error === "Not signed in." ? 401 : 403).json({ ok: false, error: gate.error });
  const r = await getAllPeople();
  return res.status(r.ok ? 200 : 400).json(r);
});

founderRouter.get("/api/founder/insights", async (req, res) => {
  const gate = requireFounder(req);
  if (!gate.ok) return res.status(gate.error === "Not signed in." ? 401 : 403).json({ ok: false, error: gate.error });
  const days = Number(req.query.days ?? 30);
  const r = await getInsights(isNaN(days) ? 30 : Math.min(180, Math.max(7, days)));
  return res.status(r.ok ? 200 : 400).json(r);
});