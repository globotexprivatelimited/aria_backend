import { Router } from "express";
import { listDeptItems, createDeptItem, updateDeptItem, deleteDeptItem } from "../deptitems/service";
export const deptItemsRouter = Router();
const ADMIN_KEY = process.env.ADMIN_API_KEY ?? "dev-admin-key";
function checkKey(req: import("express").Request): boolean { return req.header("x-admin-key") === ADMIN_KEY; }

deptItemsRouter.get("/api/dept-items", async (req, res) => {
  if (!checkKey(req)) return res.status(401).json({ error: "unauthorized" });
  const r = await listDeptItems(String(req.query.hotelId ?? ""), String(req.query.dept ?? "")); return res.status(r.ok ? 200 : 400).json(r);
});
deptItemsRouter.post("/api/dept-items/create", async (req, res) => {
  if (!checkKey(req)) return res.status(401).json({ error: "unauthorized" });
  const { hotelId, dept, ...item } = req.body ?? {};
  const r = await createDeptItem(hotelId, dept, item); return res.status(r.ok ? 200 : 400).json(r);
});
deptItemsRouter.post("/api/dept-items/update", async (req, res) => {
  if (!checkKey(req)) return res.status(401).json({ error: "unauthorized" });
  const { hotelId, id, ...fields } = req.body ?? {};
  const r = await updateDeptItem(hotelId, id, fields); return res.status(r.ok ? 200 : 400).json(r);
});
deptItemsRouter.post("/api/dept-items/delete", async (req, res) => {
  if (!checkKey(req)) return res.status(401).json({ error: "unauthorized" });
  const { hotelId, id } = req.body ?? {};
  const r = await deleteDeptItem(hotelId, id); return res.status(r.ok ? 200 : 400).json(r);
});