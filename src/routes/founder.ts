import { Router } from "express";
import { verifyToken } from "../auth/service";
import { getPortfolio, getHotelDetail, getAllPeople, getInsights } from "../founder/service";
import { getPlans, setHotelPlan, setRevenueShare, setHotelActive, getBilling, getOnboarding, setOnboardingStep, setBlocker } from "../founder/platform";
import { listTickets, createTicket, replyToTicket, updateTicket, listIncidents, createIncident, resolveIncident, listStations, upsertStation, listHotelTickets, hotelReply, stationHeartbeat, deleteStation, addCost } from "../founder/ops";

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

// ---- plans, billing, hotel settings ----
founderRouter.get("/api/founder/plans", async (req, res) => {
  const g = requireFounder(req); if (!g.ok) return res.status(403).json({ ok: false, error: g.error });
  const r = await getPlans(); return res.status(r.ok ? 200 : 400).json(r);
});
founderRouter.get("/api/founder/billing", async (req, res) => {
  const g = requireFounder(req); if (!g.ok) return res.status(403).json({ ok: false, error: g.error });
  const r = await getBilling(); return res.status(r.ok ? 200 : 400).json(r);
});
founderRouter.post("/api/founder/hotel/plan", async (req, res) => {
  const g = requireFounder(req); if (!g.ok) return res.status(403).json({ ok: false, error: g.error });
  const r = await setHotelPlan(String(req.body?.hotelId ?? ""), String(req.body?.planCode ?? ""));
  return res.status(r.ok ? 200 : 400).json(r);
});
founderRouter.post("/api/founder/hotel/share", async (req, res) => {
  const g = requireFounder(req); if (!g.ok) return res.status(403).json({ ok: false, error: g.error });
  const r = await setRevenueShare(String(req.body?.hotelId ?? ""), Number(req.body?.percent ?? 0));
  return res.status(r.ok ? 200 : 400).json(r);
});
founderRouter.post("/api/founder/hotel/active", async (req, res) => {
  const g = requireFounder(req); if (!g.ok) return res.status(403).json({ ok: false, error: g.error });
  const r = await setHotelActive(String(req.body?.hotelId ?? ""), !!req.body?.active);
  return res.status(r.ok ? 200 : 400).json(r);
});

// ---- onboarding ----
founderRouter.get("/api/founder/onboarding", async (req, res) => {
  const g = requireFounder(req); if (!g.ok) return res.status(403).json({ ok: false, error: g.error });
  const r = await getOnboarding(); return res.status(r.ok ? 200 : 400).json(r);
});
founderRouter.post("/api/founder/onboarding/step", async (req, res) => {
  const g = requireFounder(req); if (!g.ok) return res.status(403).json({ ok: false, error: g.error });
  const r = await setOnboardingStep(String(req.body?.hotelId ?? ""), String(req.body?.step ?? ""), !!req.body?.value);
  return res.status(r.ok ? 200 : 400).json(r);
});
founderRouter.post("/api/founder/onboarding/blocker", async (req, res) => {
  const g = requireFounder(req); if (!g.ok) return res.status(403).json({ ok: false, error: g.error });
  const b = req.body?.blocker; 
  const r = await setBlocker(String(req.body?.hotelId ?? ""), b ? String(b) : null);
  return res.status(r.ok ? 200 : 400).json(r);
});

// ---- support ----
founderRouter.get("/api/founder/tickets", async (req, res) => {
  const g = requireFounder(req); if (!g.ok) return res.status(403).json({ ok: false, error: g.error });
  const r = await listTickets(); return res.status(r.ok ? 200 : 400).json(r);
});
founderRouter.post("/api/founder/tickets/reply", async (req, res) => {
  const g = requireFounder(req); if (!g.ok) return res.status(403).json({ ok: false, error: g.error });
  const r = await replyToTicket(String(req.body?.ticketId ?? ""), String(req.body?.author ?? "Aria"), "aria", String(req.body?.body ?? ""));
  return res.status(r.ok ? 200 : 400).json(r);
});
founderRouter.post("/api/founder/tickets/update", async (req, res) => {
  const g = requireFounder(req); if (!g.ok) return res.status(403).json({ ok: false, error: g.error });
  const r = await updateTicket(String(req.body?.ticketId ?? ""), {
    state: req.body?.state, assignedTo: req.body?.assignedTo, priority: req.body?.priority });
  return res.status(r.ok ? 200 : 400).json(r);
});

// ---- incidents & stations ----
founderRouter.get("/api/founder/incidents", async (req, res) => {
  const g = requireFounder(req); if (!g.ok) return res.status(403).json({ ok: false, error: g.error });
  const r = await listIncidents(); return res.status(r.ok ? 200 : 400).json(r);
});
founderRouter.post("/api/founder/incidents", async (req, res) => {
  const g = requireFounder(req); if (!g.ok) return res.status(403).json({ ok: false, error: g.error });
  const r = await createIncident({ hotelId: req.body?.hotelId, kind: req.body?.kind, title: String(req.body?.title ?? ""), detail: req.body?.detail, severity: req.body?.severity });
  return res.status(r.ok ? 200 : 400).json(r);
});
founderRouter.post("/api/founder/incidents/resolve", async (req, res) => {
  const g = requireFounder(req); if (!g.ok) return res.status(403).json({ ok: false, error: g.error });
  const r = await resolveIncident(String(req.body?.id ?? "")); return res.status(r.ok ? 200 : 400).json(r);
});
founderRouter.get("/api/founder/stations", async (req, res) => {
  const g = requireFounder(req); if (!g.ok) return res.status(403).json({ ok: false, error: g.error });
  const r = await listStations(); return res.status(r.ok ? 200 : 400).json(r);
});
founderRouter.post("/api/founder/stations", async (req, res) => {
  const g = requireFounder(req); if (!g.ok) return res.status(403).json({ ok: false, error: g.error });
  const r = await upsertStation({ hotelId: String(req.body?.hotelId ?? ""), name: String(req.body?.name ?? ""), dept: req.body?.dept });
  return res.status(r.ok ? 200 : 400).json(r);
});

// a GM raises a ticket from their own dashboard
founderRouter.post("/api/support/ticket", async (req, res) => {
  const auth = req.header("authorization") ?? "";
  const tk = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  const user = tk ? verifyToken(tk) : null;
  if (!user) return res.status(401).json({ ok: false, error: "Not signed in." });
  const r = await createTicket({ hotelId: user.hotelId, raisedBy: user.fullName, subject: String(req.body?.subject ?? ""), body: req.body?.body, priority: req.body?.priority });
  return res.status(r.ok ? 200 : 400).json(r);
});

// ---- the hotel side of support ----
function sessionUser(req: import("express").Request) {
  const auth = req.header("authorization") ?? "";
  const tk = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  return tk ? verifyToken(tk) : null;
}

founderRouter.get("/api/support/my-tickets", async (req, res) => {
  const user = sessionUser(req);
  if (!user) return res.status(401).json({ ok: false, error: "Not signed in." });
  const r = await listHotelTickets(user.hotelId);
  return res.status(r.ok ? 200 : 400).json(r);
});

founderRouter.post("/api/support/reply", async (req, res) => {
  const user = sessionUser(req);
  if (!user) return res.status(401).json({ ok: false, error: "Not signed in." });
  const r = await hotelReply(user.hotelId, String(req.body?.ticketId ?? ""), user.fullName ?? "Hotel", String(req.body?.body ?? ""));
  return res.status(r.ok ? 200 : 400).json(r);
});

founderRouter.post("/api/founder/stations/remove", async (req, res) => {
  const g = requireFounder(req); if (!g.ok) return res.status(403).json({ ok: false, error: g.error });
  const r = await deleteStation(String(req.body?.id ?? "")); return res.status(r.ok ? 200 : 400).json(r);
});
founderRouter.post("/api/founder/costs", async (req, res) => {
  const g = requireFounder(req); if (!g.ok) return res.status(403).json({ ok: false, error: g.error });
  const r = await addCost({ category: String(req.body?.category ?? ""), amount: Number(req.body?.amount ?? 0), note: req.body?.note });
  return res.status(r.ok ? 200 : 400).json(r);
});

/** Any signed-in staff member working a department keeps that station alive. */
founderRouter.post("/api/stations/heartbeat", async (req, res) => {
  const user = sessionUser(req);
  if (!user) return res.status(401).json({ ok: false, error: "Not signed in." });
  const dept = String(req.body?.dept ?? "");
  if (!dept) return res.status(400).json({ ok: false, error: "dept required" });
  const r = await stationHeartbeat(user.hotelId, dept);
  return res.status(r.ok ? 200 : 400).json(r);
});