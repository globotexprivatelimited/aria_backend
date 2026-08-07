import { Router } from "express";
import { verifyToken } from "../auth/service";
import { listSlots, addSlot, updateSlot, deleteSlot, getAvailability, bookSlot, listBookings, cancelBooking } from "../slots/service";

export const slotBookingRouter = Router();

function user(req: import("express").Request) {
  const auth = req.header("authorization") ?? "";
  const tk = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  return tk ? verifyToken(tk) : null;
}

slotBookingRouter.get("/api/booking/slots", async (req, res) => {
  const u = user(req); if (!u) return res.status(401).json({ ok: false, error: "Not signed in." });
  const r = await listSlots(u.hotelId, String(req.query.dept ?? ""));
  return res.status(r.ok ? 200 : 400).json(r);
});

slotBookingRouter.post("/api/booking/slots/add", async (req, res) => {
  const u = user(req); if (!u) return res.status(401).json({ ok: false, error: "Not signed in." });
  const b = req.body ?? {};
  const r = await addSlot({
    hotelId: u.hotelId, dept: String(b.dept ?? ""), itemId: b.itemId ?? null,
    label: String(b.label ?? ""), startTime: String(b.startTime ?? ""), endTime: b.endTime ?? null,
    capacity: Number(b.capacity ?? 1), days: Array.isArray(b.days) ? b.days : undefined,
  });
  return res.status(r.ok ? 200 : 400).json(r);
});

slotBookingRouter.post("/api/booking/slots/update", async (req, res) => {
  const u = user(req); if (!u) return res.status(401).json({ ok: false, error: "Not signed in." });
  const b = req.body ?? {};
  const r = await updateSlot(String(b.id ?? ""), {
    capacity: b.capacity != null ? Number(b.capacity) : undefined,
    active: b.active != null ? !!b.active : undefined,
    days: Array.isArray(b.days) ? b.days : undefined,
    label: b.label,
  });
  return res.status(r.ok ? 200 : 400).json(r);
});

slotBookingRouter.post("/api/booking/slots/remove", async (req, res) => {
  const u = user(req); if (!u) return res.status(401).json({ ok: false, error: "Not signed in." });
  const r = await deleteSlot(String(req.body?.id ?? ""));
  return res.status(r.ok ? 200 : 400).json(r);
});

/** What is free on a date - the question Aria needs answered. */
slotBookingRouter.get("/api/booking/slots/availability", async (req, res) => {
  const u = user(req); if (!u) return res.status(401).json({ ok: false, error: "Not signed in." });
  const r = await getAvailability(u.hotelId, String(req.query.dept ?? ""), String(req.query.date ?? ""), req.query.itemId ? String(req.query.itemId) : null);
  return res.status(r.ok ? 200 : 400).json(r);
});

slotBookingRouter.post("/api/booking/slots/book", async (req, res) => {
  const u = user(req); if (!u) return res.status(401).json({ ok: false, error: "Not signed in." });
  const b = req.body ?? {};
  const r = await bookSlot({
    hotelId: u.hotelId, slotId: String(b.slotId ?? ""), onDate: String(b.onDate ?? ""),
    roomNumber: b.roomNumber, guestName: b.guestName, guestPhone: b.guestPhone,
    partySize: b.partySize != null ? Number(b.partySize) : 1, note: b.note,
  });
  return res.status(r.ok ? 200 : 400).json(r);
});

slotBookingRouter.get("/api/booking/slots/bookings", async (req, res) => {
  const u = user(req); if (!u) return res.status(401).json({ ok: false, error: "Not signed in." });
  const r = await listBookings(u.hotelId, String(req.query.dept ?? ""), String(req.query.date ?? ""));
  return res.status(r.ok ? 200 : 400).json(r);
});

slotBookingRouter.post("/api/booking/slots/cancel", async (req, res) => {
  const u = user(req); if (!u) return res.status(401).json({ ok: false, error: "Not signed in." });
  const r = await cancelBooking(String(req.body?.id ?? ""));
  return res.status(r.ok ? 200 : 400).json(r);
});
