jest.mock("../src/auth/service", () => ({
  verifyToken: (t: string) => (({
    "gm-a": { staffUserId: "1", role: "gm", hotelId: "A", fullName: "GM A", email: "a@example.com" },
    "hk-a": { staffUserId: "3", role: "housekeeping", hotelId: "A", fullName: "Housekeeping A", email: "h@example.com" },
    "desk-a": { staffUserId: "4", role: "front_desk", hotelId: "A", fullName: "Desk A", email: "d@example.com" },
    founder: { staffUserId: "5", role: "founder", hotelId: "HQ", fullName: "Founder", email: "f@example.com" },
  } as Record<string, unknown>)[t] ?? null),
}));
// No database and no WhatsApp: every call the routes make is answered here and recorded.
jest.mock("../src/db", () => {
  const calls: unknown[] = [];
  const empty: Record<string, unknown> = { count: 0, findMany: [], groupBy: [], findFirst: null, findUnique: null, aggregate: { _sum: {}, _avg: {}, _count: {} } };
  const model = new Proxy({}, { get: (_t, op) => async (...args: unknown[]) => { calls.push(args); return String(op) in empty ? empty[String(op)] : {}; } });
  return { prisma: new Proxy({}, { get: (_t, name) => (name === "mockCalls" ? calls : model) }) };
});
jest.mock("../src/lib/notify", () => ({ sendReply: jest.fn(async () => ({ ok: true })) }));
jest.mock("../src/privacy/consent", () => ({ CONSENT_NOTICE: "notice", listConsent: jest.fn(async () => []), getConsent: jest.fn(async () => null), recordConsent: jest.fn(async () => ({})) }));
jest.mock("../src/privacy/erasure", () => ({ exportGuestData: jest.fn(async () => ({})), eraseGuestData: jest.fn(async () => ({ recordsWiped: 0 })) }));
jest.mock("../src/presence/service", () => ({ touchPresence: jest.fn(async () => undefined), getDepartmentPresence: jest.fn(async () => []) }));
jest.mock("../src/lib/frontdesk", () => ({ checkInGuest: jest.fn(async () => ({ id: "s1" })), checkOutGuest: jest.fn(async () => ({ id: "s1" })) }));
jest.mock("../src/lib/optin", () => ({ optInOf: jest.fn(async () => true) }));

import express from "express";
import type { Server } from "http";
import type { AddressInfo } from "net";
import { tenantGuard } from "../src/lib/security";
import { prisma } from "../src/db";
import { frontdeskRouter } from "../src/routes/frontdesk";
import { dashboardRouter } from "../src/routes/dashboard";
import { privacyRouter } from "../src/routes/privacy";
import { presenceRouter } from "../src/routes/presence";

const KEY = "q7Wm2Xc9Rv4Lp8Tz3Bn6Hd1Kf5Gs0Ja";
let server: Server;
let base = "";

beforeAll(async () => {
  process.env.ADMIN_API_KEY = KEY;
  const app = express();
  app.use(express.json());
  app.use("/api", tenantGuard);
  app.use(frontdeskRouter);
  app.use(dashboardRouter);
  app.use(privacyRouter);
  app.use(presenceRouter);
  await new Promise<void>((resolve) => { server = app.listen(0, "127.0.0.1", () => resolve()); });
  base = "http://127.0.0.1:" + (server.address() as AddressInfo).port;
});
afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

type Method = "GET" | "POST";
async function call(method: Method, path: string, opts: { token?: string; key?: string; body?: unknown } = {}): Promise<number> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (opts.token) headers.authorization = "Bearer " + opts.token;
  if (opts.key) headers["x-admin-key"] = opts.key;
  const r = await fetch(base + path, { method, headers, body: method === "POST" ? JSON.stringify(opts.body ?? {}) : undefined });
  await r.text();
  return r.status;
}
/** Got past who-may-call - what the route then answers (200, 400 for a missing field) is its own business. */
const allowed = (status: number): boolean => status !== 401 && status !== 403;
const GUEST = { room: "101", name: "Asha Rao", phone: "+919800000001" };
const ROUTES: [Method, string, unknown?][] = [
  ["POST", "/api/checkin", GUEST],
  ["POST", "/api/checkout", { room: "101" }],
  ["GET", "/api/dashboard/overview"],
  ["GET", "/api/dashboard/alerts"],
  ["GET", "/api/presence/departments"],
  ["GET", "/api/privacy/export?phone=%2B919800000001"],
  ["POST", "/api/privacy/erase", { phone: "+919800000001", requestedBy: "console" }],
];

describe("check-in, the manager's feed, presence and privacy take the signed-in person (item 11)", () => {
  test("nobody signed in, a wrong key or a forged token gets none of them", async () => {
    for (const [m, p, body] of ROUTES) {
      expect([p, await call(m, p, { body })]).toEqual([p, 401]);
      expect([p, await call(m, p, { body, key: "wrong-key-of-the-same-sort-00000" })]).toEqual([p, 401]);
      expect([p, await call(m, p, { body, token: "forged" })]).toEqual([p, 401]);
    }
  });
  test("a housekeeper's sign-in opens none of them", async () => {
    for (const [m, p, body] of ROUTES) expect([p, await call(m, p, { body, token: "hk-a" })]).toEqual([p, 401]);
  });
  test("the front desk checks guests in and out at its own hotel, and reads nothing else", async () => {
    expect(allowed(await call("POST", "/api/checkin", { token: "desk-a", body: GUEST }))).toBe(true);
    expect(allowed(await call("POST", "/api/checkout", { token: "desk-a", body: { room: "101" } }))).toBe(true);
    expect(await call("POST", "/api/checkin", { token: "desk-a", body: { ...GUEST, hotelId: "B" } })).toBe(403);
    expect(await call("GET", "/api/dashboard/overview", { token: "desk-a" })).toBe(401);
    expect(await call("GET", "/api/presence/departments", { token: "desk-a" })).toBe(401);
    expect(await call("GET", "/api/privacy/export?phone=%2B919800000001", { token: "desk-a" })).toBe(401);
  });
  test("a GM gets every one of them for their own hotel, and is refused another hotel", async () => {
    for (const [m, p, body] of ROUTES) expect([p, allowed(await call(m, p, { body, token: "gm-a" }))]).toEqual([p, true]);
    expect(JSON.stringify((prisma as unknown as { mockCalls: unknown[] }).mockCalls)).toContain('"hotelId":"A"');
    expect(await call("GET", "/api/dashboard/overview?hotelId=B", { token: "gm-a" })).toBe(403);
    expect(await call("GET", "/api/presence/departments?hotelId=B", { token: "gm-a" })).toBe(403);
    expect(await call("POST", "/api/privacy/erase", { token: "gm-a", body: { hotelId: "B", phone: "+919800000001" } })).toBe(403);
  });
  test("a founder and the platform key still get in, and the privacy notice stays public", async () => {
    expect(allowed(await call("GET", "/api/dashboard/overview?hotelId=B", { token: "founder" }))).toBe(true);
    expect(allowed(await call("GET", "/api/dashboard/overview?hotelId=A", { key: KEY }))).toBe(true);
    expect(allowed(await call("POST", "/api/checkin", { key: KEY, body: { ...GUEST, hotelId: "A" } }))).toBe(true);
    expect(await call("GET", "/api/privacy/notice")).toBe(200);
  });
});
