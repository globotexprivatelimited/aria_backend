import { Router, type Request, type Response, type NextFunction } from "express";
import { prisma } from "../db";
import { checkInGuest, checkOutGuest } from "../lib/frontdesk";

export const frontdeskRouter = Router();

function requireAdmin(req: Request, res: Response, next: NextFunction) {
  const key = process.env.ADMIN_API_KEY ?? "";
  if (!key || req.header("x-admin-key") !== key) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  next();
}

frontdeskRouter.post("/api/checkin", requireAdmin, async (req, res) => {
  const { hotelId, room, name, phone } = req.body ?? {};
  if (!hotelId || !room || !name || !phone) {
    res.status(400).json({ error: "hotelId, room, name, phone are required" });
    return;
  }
  const hotel = await prisma.hotel.findUnique({ where: { hotelId } });
  if (!hotel) {
    res.status(404).json({ error: "hotel not found" });
    return;
  }
  const session = await checkInGuest(hotelId, room, name, phone);
  res.json({ ok: true, sessionId: session.id, state: session.state, room: session.roomNumber, verified: session.roomVerified });
});

frontdeskRouter.post("/api/checkout", requireAdmin, async (req, res) => {
  const { hotelId, room, phone } = req.body ?? {};
  if (!hotelId || (!room && !phone)) {
    res.status(400).json({ error: "hotelId and (room or phone) are required" });
    return;
  }
  const session = await checkOutGuest(hotelId, { room, phone });
  res.json({ ok: Boolean(session), closed: Boolean(session) });
});
