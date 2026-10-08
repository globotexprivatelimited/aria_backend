import { optInOf } from "../lib/optin";
import { Router, type Request, type Response, type NextFunction } from "express";
import { consoleCaller, FRONT_DESK_ROLES } from "../lib/security";
import { prisma } from "../db";
import { checkInGuest, checkOutGuest } from "../lib/frontdesk";

export const frontdeskRouter = Router();

/** The reception desk or a manager, signed in and held to their own hotel by tenantGuard - or the platform key for scripts (item 11). */
function requireDesk(req: Request, res: Response, next: NextFunction) {
  if (!consoleCaller(req, FRONT_DESK_ROLES)) {
    res.status(401).json({ ok: false, error: "unauthorized" });
    return;
  }
  next();
}

frontdeskRouter.post("/api/checkin", requireDesk, async (req, res) => {
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
  const session = await checkInGuest(hotelId, room, name, phone, undefined, optInOf(req));
  res.json({ ok: true, sessionId: session.id, state: session.state, room: session.roomNumber, verified: session.roomVerified });
});

frontdeskRouter.post("/api/checkout", requireDesk, async (req, res) => {
  const { hotelId, room, phone } = req.body ?? {};
  if (!hotelId || (!room && !phone)) {
    res.status(400).json({ error: "hotelId and (room or phone) are required" });
    return;
  }
  const session = await checkOutGuest(hotelId, { room, phone });
  res.json({ ok: Boolean(session), closed: Boolean(session) });
});
