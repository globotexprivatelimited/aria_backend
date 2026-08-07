import { Router, type Request, type Response, type NextFunction } from "express";
import { prisma } from "../db";
import { asyncRoute } from "../lib/errors";
import { universalCheckin, universalCheckout, universalUpdate, universalBulkImport } from "../universal/service";

export const universalRouter = Router();

/**
 * A hotel's PMS authenticates with the hotel's webhook token in the URL
 * (same secret already used for the WhatsApp webhook). This identifies the
 * hotel and authorises the call in one step.
 */
async function resolveHotel(req: Request, res: Response, next: NextFunction) {
  const token = req.params.hotelToken;
  const hotel = await prisma.hotel.findFirst({ where: { webhookToken: String(token ?? ""), isActive: true } });
  if (!hotel) {
    res.status(401).json({ ok: false, error: "unknown_hotel_token" });
    return;
  }
  (req as Request & { hotelId?: string }).hotelId = hotel.hotelId;
  next();
}

universalRouter.post("/api/v1/universal/:hotelToken/checkin", resolveHotel, asyncRoute(async (req, res) => {
  const hotelId = (req as Request & { hotelId: string }).hotelId;
  const adapter = typeof req.query.source === "string" ? req.query.source : undefined;
  const result = await universalCheckin(hotelId, req.body ?? {}, adapter);
  res.status(result.ok ? 200 : 400).json(result);
}));

universalRouter.post("/api/v1/universal/:hotelToken/checkout", resolveHotel, asyncRoute(async (req, res) => {
  const hotelId = (req as Request & { hotelId: string }).hotelId;
  const result = await universalCheckout(hotelId, req.body ?? {});
  res.status(result.ok ? 200 : 400).json(result);
}));

universalRouter.post("/api/v1/universal/:hotelToken/update", resolveHotel, asyncRoute(async (req, res) => {
  const hotelId = (req as Request & { hotelId: string }).hotelId;
  const result = await universalUpdate(hotelId, req.body ?? {});
  res.status(result.ok ? 200 : 400).json(result);
}));

universalRouter.post("/api/v1/universal/:hotelToken/import", resolveHotel, asyncRoute(async (req, res) => {
  const hotelId = (req as Request & { hotelId: string }).hotelId;
  const rows = Array.isArray(req.body?.rows) ? req.body.rows : Array.isArray(req.body) ? req.body : [];
  const result = await universalBulkImport(hotelId, rows);
  res.json(result);
}));
