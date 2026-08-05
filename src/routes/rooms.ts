import { Router } from "express";
import { listRooms, setupRooms, upsertRoom, checkInRoom, checkOutRoom, markClean, roomStats, editRoom, deleteRoom, clearFloor, hotelRoomTarget } from "../rooms/service";
export const roomsRouter = Router();
const ADMIN_KEY = process.env.ADMIN_API_KEY ?? "dev-admin-key";
function checkKey(req: import("express").Request): boolean { return req.header("x-admin-key") === ADMIN_KEY; }

roomsRouter.get("/api/rooms", async (req, res) => {
  if (!checkKey(req)) return res.status(401).json({ error: "unauthorized" });
  const r = await listRooms(String(req.query.hotelId ?? "")); return res.status(r.ok ? 200 : 400).json(r);
});
roomsRouter.get("/api/rooms/stats", async (req, res) => {
  if (!checkKey(req)) return res.status(401).json({ error: "unauthorized" });
  const r = await roomStats(String(req.query.hotelId ?? "")); return res.status(r.ok ? 200 : 400).json(r);
});
roomsRouter.post("/api/rooms/setup", async (req, res) => {
  if (!checkKey(req)) return res.status(401).json({ error: "unauthorized" });
  const { hotelId, floors } = req.body ?? {};
  const r = await setupRooms(hotelId, floors); return res.status(r.ok ? 200 : 400).json(r);
});
roomsRouter.post("/api/rooms/upsert", async (req, res) => {
  if (!checkKey(req)) return res.status(401).json({ error: "unauthorized" });
  const { hotelId, room } = req.body ?? {};
  const r = await upsertRoom(hotelId, room); return res.status(r.ok ? 200 : 400).json(r);
});
roomsRouter.post("/api/rooms/checkin", async (req, res) => {
  if (!checkKey(req)) return res.status(401).json({ error: "unauthorized" });
  const { hotelId, roomNumber, guestName, guestPhone, partySize, checkOut } = req.body ?? {};
  const r = await checkInRoom(hotelId, roomNumber, { guestName, guestPhone, partySize, checkOut }); return res.status(r.ok ? 200 : 400).json(r);
});
roomsRouter.post("/api/rooms/checkout", async (req, res) => {
  if (!checkKey(req)) return res.status(401).json({ error: "unauthorized" });
  const { hotelId, roomNumber } = req.body ?? {};
  const r = await checkOutRoom(hotelId, roomNumber); return res.status(r.ok ? 200 : 400).json(r);
});
roomsRouter.post("/api/rooms/clean", async (req, res) => {
  if (!checkKey(req)) return res.status(401).json({ error: "unauthorized" });
  const { hotelId, roomNumber } = req.body ?? {};
  const r = await markClean(hotelId, roomNumber); return res.status(r.ok ? 200 : 400).json(r);
});

roomsRouter.post("/api/rooms/edit", async (req, res) => {
  if (!checkKey(req)) return res.status(401).json({ error: "unauthorized" });
  const { hotelId, roomNumber, room_type, floor, newNumber } = req.body ?? {};
  const r = await editRoom(hotelId, roomNumber, { room_type, floor, newNumber }); return res.status(r.ok ? 200 : 400).json(r);
});
roomsRouter.post("/api/rooms/delete", async (req, res) => {
  if (!checkKey(req)) return res.status(401).json({ error: "unauthorized" });
  const { hotelId, roomNumber } = req.body ?? {};
  const r = await deleteRoom(hotelId, roomNumber); return res.status(r.ok ? 200 : 400).json(r);
});
roomsRouter.post("/api/rooms/clear-floor", async (req, res) => {
  if (!checkKey(req)) return res.status(401).json({ error: "unauthorized" });
  const { hotelId, floor } = req.body ?? {};
  const r = await clearFloor(hotelId, Number(floor)); return res.status(r.ok ? 200 : 400).json(r);
});

roomsRouter.get("/api/rooms/target", async (req, res) => {
  if (!checkKey(req)) return res.status(401).json({ error: "unauthorized" });
  const r = await hotelRoomTarget(String(req.query.hotelId ?? "")); return res.status(r.ok ? 200 : 400).json(r);
});