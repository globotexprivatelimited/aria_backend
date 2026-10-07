jest.mock("../src/auth/service", () => ({
  verifyToken: (t: string) => (({
    "gm-a": { staffUserId: "1", role: "gm", hotelId: "A", fullName: "GM A", email: "a@example.com" },
    "gm-b": { staffUserId: "2", role: "gm", hotelId: "B", fullName: "GM B", email: "b@example.com" },
    "hk-a": { staffUserId: "3", role: "housekeeping", hotelId: "A", fullName: "Housekeeping A", email: "h@example.com" },
    "desk-a": { staffUserId: "4", role: "front_desk", hotelId: "A", fullName: "Desk A", email: "d@example.com" },
    founder: { staffUserId: "5", role: "founder", hotelId: "HQ", fullName: "Founder", email: "f@example.com" },
  } as Record<string, unknown>)[t] ?? null),
}));

import express from "express";
import type { Server } from "http";
import type { AddressInfo } from "net";
import { tenantGuard, consoleCaller, founderCaller, ANY_HOTEL_ROLE, FRONT_DESK_ROLES } from "../src/lib/security";

const KEY = "k9Qx2Lm7Vt4Rz8Wp3Nc6Hy1Bd5Fg0Js";
let server: Server;
let base = "";

beforeAll(async () => {
  process.env.ADMIN_API_KEY = KEY;
  const app = express();
  app.use(express.json());
  app.use("/api", tenantGuard);
  const answer = (allowed: boolean, req: express.Request, res: express.Response) => (allowed ? res.json({ ok: true, hotelId: req.query.hotelId ?? (req.body ?? {}).hotelId ?? null }) : res.status(401).json({ ok: false }));
  app.get("/api/revenue/summary", (req, res) => answer(consoleCaller(req), req, res));
  app.post("/api/menu/patch", (req, res) => answer(consoleCaller(req), req, res));
  app.post("/api/rooms/checkin", (req, res) => answer(consoleCaller(req, FRONT_DESK_ROLES), req, res));
  app.get("/api/dept-config", (req, res) => answer(consoleCaller(req, ANY_HOTEL_ROLE), req, res));
  app.get("/api/requests/all-active", (req, res) => answer(founderCaller(req), req, res));
  await new Promise<void>((resolve) => { server = app.listen(0, "127.0.0.1", () => resolve()); });
  base = "http://127.0.0.1:" + (server.address() as AddressInfo).port;
});
afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

async function call(method: "GET" | "POST", path: string, opts: { token?: string; key?: string; body?: unknown } = {}): Promise<{ status: number; hotelId: unknown }> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (opts.token) headers.authorization = "Bearer " + opts.token;
  if (opts.key) headers["x-admin-key"] = opts.key;
  const r = await fetch(base + path, { method, headers, body: method === "POST" ? JSON.stringify(opts.body ?? {}) : undefined });
  const j = (await r.json()) as { hotelId?: unknown };
  return { status: r.status, hotelId: j.hotelId };
}

describe("a hotel's people reach only their own hotel", () => {
  test("a GM of hotel A is refused hotel B's data, by query and by body", async () => {
    expect((await call("GET", "/api/revenue/summary?hotelId=B", { token: "gm-a" })).status).toBe(403);
    expect((await call("POST", "/api/menu/patch", { token: "gm-a", body: { hotelId: "B", id: "1", fields: {} } })).status).toBe(403);
  });
  test("a GM of hotel A gets hotel A, even when no hotel is named", async () => {
    expect(await call("GET", "/api/revenue/summary", { token: "gm-a" })).toEqual({ status: 200, hotelId: "A" });
    expect(await call("POST", "/api/menu/patch", { token: "gm-a", body: { id: "1", fields: {} } })).toEqual({ status: 200, hotelId: "A" });
  });
  test("staff cannot use the manager's routes, but read their own department setup", async () => {
    expect((await call("GET", "/api/revenue/summary", { token: "hk-a" })).status).toBe(401);
    expect(await call("GET", "/api/dept-config", { token: "hk-a" })).toEqual({ status: 200, hotelId: "A" });
    expect((await call("GET", "/api/dept-config?hotelId=B", { token: "hk-a" })).status).toBe(403);
  });
  test("the front desk checks guests in at its own hotel only", async () => {
    expect(await call("POST", "/api/rooms/checkin", { token: "desk-a", body: { roomNumber: "101" } })).toEqual({ status: 200, hotelId: "A" });
    expect((await call("POST", "/api/rooms/checkin", { token: "desk-a", body: { hotelId: "B", roomNumber: "101" } })).status).toBe(403);
    expect((await call("GET", "/api/revenue/summary", { token: "desk-a" })).status).toBe(401);
  });
  test("only a founder or the platform key sees every hotel", async () => {
    expect((await call("GET", "/api/requests/all-active", { token: "gm-a" })).status).toBe(401);
    expect((await call("GET", "/api/requests/all-active", { token: "founder" })).status).toBe(200);
    expect((await call("GET", "/api/requests/all-active", { key: KEY })).status).toBe(200);
    expect((await call("GET", "/api/revenue/summary?hotelId=B", { token: "founder" })).status).toBe(200);
  });
  test("no sign-in, a wrong key or a forged token gets nothing", async () => {
    expect((await call("GET", "/api/revenue/summary?hotelId=A")).status).toBe(401);
    expect((await call("GET", "/api/revenue/summary?hotelId=A", { key: "wrong-key-of-the-same-sort-0000" })).status).toBe(401);
    expect((await call("GET", "/api/revenue/summary?hotelId=A", { token: "forged" })).status).toBe(401);
  });
});
