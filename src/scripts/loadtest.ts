import "dotenv/config";
import { spawn, execSync, type ChildProcess } from "child_process";
import { createHmac, randomBytes } from "crypto";
import { createWriteStream, mkdirSync, readFileSync, writeFileSync, type WriteStream } from "fs";
import { join } from "path";
import { prisma } from "../db";
import { analyse, isNotice, percentile, type LtSent, type LtReply, type LtResult } from "../lib/loadAnalysis";

// this process sends nothing either - whatever it imports, WhatsApp stays off
process.env.META_SEND = "off";

/**
 * Load and concurrency test - pending item 31, acceptance rows U03, U04, U05 (and B12 for memory).
 *
 * Starts its OWN copy of the API on another port with META_SEND=off, so not one message can leave for WhatsApp,
 * a throwaway webhook secret and admin key, and the scheduler off. Then it plays guests at it through the real
 * signed webhook, from fictional numbers (555-0100 to 555-0199 are reserved for fiction):
 *   A  20 guests at once, three questions each, every one waiting for its answer      (U04)
 *   B  a peak of 50 messages in five minutes, two per guest, at random moments         (U05)
 *   C  one message with three questions in it, from five guests                      (U03)
 * Guests are checked in first, through the server copy's own /api/checkin (no opt-in, so no welcome is sent, and the
 * stay reminders check-in schedules are cancelled at once) - in-house guests, as the acceptance rows mean them.
 * --prospects skips the check-in and plays strangers who have never stayed.
 * It measures the webhook's acknowledgement, the time to Aria's reply (the outbound row the server writes),
 * messages never processed, questions never answered, replies out of order, fallback replies (the AI not answering),
 * and the server's memory, CPU and event-loop lag. Every row it creates is deleted at the end.
 * The privacy notice each guest gets on first contact is counted on its own and never taken for an answer, and every
 * scenario waits for its last answer (or the timeout) before it is scored.
 *
 *   pnpm loadtest                       lists the hotels it can run against
 *   pnpm loadtest --hotel 16            the full run (about 115 AI replies)
 *   pnpm loadtest --hotel 16 --guests 5 --peak 10 --minutes 1 --multi 2    a quick run
 *   pnpm loadtest --hotel 16 --only A   one scenario;  --keep leaves the rows;  --port 5099 another port
 *   pnpm loadtest --hotel 16 --prospects   guests who are not checked in
 *   pnpm loadtest --cleanup             deletes everything any earlier run left behind
 */
const args = process.argv.slice(2);
function opt(name: string): string | undefined { const i = args.indexOf("--" + name); if (i < 0) return undefined; const v = args[i + 1]; return v && !v.startsWith("--") ? v : "true"; }
function int(name: string, dflt: number, max: number): number { const v = Number(opt(name)); return Number.isFinite(v) && v > 0 ? Math.min(Math.floor(v), max) : dflt; }

const HOTEL = opt("hotel");
const GUESTS = int("guests", 20, 99);
const PEAK = int("peak", 50, 198);
const MINUTES = int("minutes", 5, 60);
const MULTI_GUESTS = int("multi", 5, 99);
const TIMEOUT_MS = int("timeout", 90, 600) * 1000;
const PORT = int("port", 4999, 65000);
const KEEP = opt("keep") === "true";
const PROSPECTS = opt("prospects") === "true";
const ONLY = (opt("only") ?? "A,B,C").toUpperCase().split(",").map((s) => s.trim());
const RUN = Date.now().toString(36);

const TOPICS: { ask: string; re: RegExp }[] = [
  { ask: "What time is breakfast?", re: /breakfast/i },
  { ask: "Is the swimming pool open today?", re: /pool/i },
  { ask: "What is the wifi password?", re: /wi-?fi|password|network/i },
  { ask: "What time is check-out?", re: /check-?out/i },
  { ask: "Do you have parking?", re: /park/i },
  { ask: "Is there a gym?", re: /gym|fitness/i },
];
const MULTI = { ask: "Hi! What time is breakfast, is the pool open today, and what is the wifi password?", topics: [TOPICS[0].re, TOPICS[1].re, TOPICS[2].re] };
const FALLBACK = /one of our team|someone from our team|team will be with you|get someone/i;
const AREAS = { A: "202", B: "303", C: "404" } as const;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const digits = (s: unknown): string => String(s ?? "").replace(/\D/g, "");
const last10 = (s: unknown): string => digits(s).slice(-10);
/** A fictional number: +1 <area> 555-01xx. */
const phoneFor = (area: string, i: number): string => "1" + area + "55501" + String(i).padStart(2, "0");
const allFictional = (): string[] => Object.values(AREAS).flatMap((a) => Array.from({ length: 99 }, (_, i) => last10(phoneFor(a, i + 1))));
const fmtS = (ms: number): string => (ms / 1000).toFixed(1);

/* ---------------------------------------------------------------- the server copy ---- */

const SECRET = randomBytes(24).toString("hex");
const KEY = randomBytes(24).toString("hex");
let base = "http://127.0.0.1:" + PORT;
const tail: string[] = [];
let child: ChildProcess | null = null;
let serverLog: WriteStream | null = null;
let suppressed = 0;

function startServer(): ChildProcess {
  const env: NodeJS.ProcessEnv = { ...process.env, PORT: String(PORT), META_SEND: "off", META_ACCESS_TOKEN: "loadtest-sending-disabled", META_APP_SECRET: SECRET, ADMIN_API_KEY: KEY, ARIA_SCHEDULER: "off" };
  delete env.ADMIN_API_KEY_PREVIOUS;
  const c = spawn(process.execPath, ["--import", "tsx", join("src", "server.ts")], { env, stdio: ["ignore", "pipe", "pipe"] });
  const keep = (b: Buffer) => { for (const line of b.toString().split(/\r?\n/)) { if (!line.trim()) continue; serverLog?.write(line + "\n"); if (/reply suppressed/i.test(line)) suppressed++; tail.push(line.slice(0, 300)); if (tail.length > 40) tail.shift(); } };
  c.stdout?.on("data", keep); c.stderr?.on("data", keep);
  return c;
}
function stopServer(): void {
  if (serverLog) { serverLog.end(); serverLog = null; }
  if (!child || child.exitCode !== null) return;
  try { if (process.platform === "win32") execSync("taskkill /pid " + child.pid + " /T /F", { stdio: "ignore" }); else child.kill("SIGTERM"); } catch { /* already gone */ }
}
async function answers(url: string): Promise<boolean> {
  try { const r = await fetch(url + "/webhooks/meta?hub.mode=ping", { signal: AbortSignal.timeout(2000) }); return r.status > 0; } catch { return false; }
}

/* ---------------------------------------------------------------- guests and replies ---- */

function payload(phoneId: string, from: string, id: string, body: string): string {
  return JSON.stringify({ object: "whatsapp_business_account", entry: [{ id: "loadtest", changes: [{ field: "messages", value: { messaging_product: "whatsapp", metadata: { display_phone_number: "loadtest", phone_number_id: phoneId }, contacts: [{ profile: { name: "Load Test" }, wa_id: from }], messages: [{ from, id, timestamp: String(Math.floor(Date.now() / 1000)), type: "text", text: { body } }] } }] }] });
}

let seq = 0;
async function send(phoneId: string, guest: string, body: string, topics: RegExp[]): Promise<LtSent> {
  const id = "wamid.LOADTEST." + RUN + "." + ++seq;
  const raw = payload(phoneId, guest, id, body);
  const sig = "sha256=" + createHmac("sha256", SECRET).update(raw).digest("hex");
  const at = Date.now();
  try {
    const r = await fetch(base + "/webhooks/meta", { method: "POST", headers: { "content-type": "application/json", "x-hub-signature-256": sig }, body: raw, signal: AbortSignal.timeout(30000) });
    return { guest: last10(guest), topics, ask: body, at, ackMs: Date.now() - at, status: r.status, id };
  } catch { return { guest: last10(guest), topics, ask: body, at, ackMs: Date.now() - at, status: 0, id }; }
}

const replies: LtReply[] = [];
const seen = new Set<string>();
const ours = new Set<string>();
let runStart = Date.now();
async function pollReplies(hotelId: string): Promise<void> {
  const rows = await prisma.$queryRawUnsafe<any[]>("select id, \"guestPhone\", body, \"createdAt\" from \"Message\" where \"hotelId\" = $1 and direction = 'outbound' and \"createdAt\" > now() - interval '60 minutes'", hotelId);
  const now = Date.now();
  for (const r of rows) {
    const id = String(r.id); if (seen.has(id)) continue;
    const g = last10(r.guestPhone); if (!ours.has(g)) continue;
    seen.add(id);
    const created = r.createdAt ? new Date(r.createdAt).getTime() : now;
    if (created < runStart - 60000) continue;
    replies.push({ guest: g, at: created > now + 1000 || created < runStart - 5000 ? now : Math.min(created, now), seenAt: now, body: String(r.body ?? "") });
  }
}
async function waitReply(guest: string, after: number, timeoutMs: number): Promise<boolean> {
  const g = last10(guest); const until = Date.now() + timeoutMs;
  while (Date.now() < until) { if (replies.some((r) => r.guest === g && r.seenAt >= after && !isNotice(r.body))) return true; await sleep(400); }
  return false;
}
/** Wait until every message has its answer (and, for multi-question messages, every question is covered) or the
 *  timeout has run out for the last one, then a few seconds more for a reply that comes in two parts. */
async function settle(sent: LtSent[], fullCoverage = false): Promise<void> {
  const until = Math.max(Date.now(), ...sent.map((s) => s.at + TIMEOUT_MS));
  let allAnsweredAt = 0;
  while (Date.now() < until) {
    const r = analyse(sent, replies, FALLBACK);
    if (r.unanswered === 0) {
      if (!fullCoverage || r.coverage.every((c) => c >= 1)) break;
      if (!allAnsweredAt) allAnsweredAt = Date.now();
      else if (Date.now() - allAnsweredAt > 20000) break; // every message has its answer; a question it left out is not coming
    }
    await sleep(1000);
  }
  await sleep(4000);
}
async function markProcessed(list: LtSent[]): Promise<void> {
  if (!list.length) return;
  const ids = list.map((s) => s.id);
  const rows = await prisma.$queryRawUnsafe<any[]>("select \"messageId\" from \"ProcessedMessage\" where \"messageId\" = any($1::text[])", ids);
  const got = new Set(rows.map((r) => String(r.messageId)));
  for (const s of list) s.processed = got.has(s.id);
}

/* ---------------------------------------------------------------- the server's vital signs ---- */

type Sample = { at: number; rssMb: number; heapUsedMb: number; cpuMs: number; lagMaxMs: number };
const samples: Sample[] = [];
async function sample(): Promise<void> {
  try {
    const r = await fetch(base + "/api/system/status", { headers: { "x-admin-key": KEY }, signal: AbortSignal.timeout(3000) });
    const j = (await r.json()) as { data?: { process?: { rssMb: number; heapUsedMb: number; cpuUserMs: number; cpuSystemMs: number; eventLoopLagMs?: { max: number } } } };
    const p = j.data?.process; if (!p) return;
    samples.push({ at: Date.now(), rssMb: p.rssMb, heapUsedMb: p.heapUsedMb, cpuMs: p.cpuUserMs + p.cpuSystemMs, lagMaxMs: p.eventLoopLagMs?.max ?? 0 });
  } catch { /* the server is busy - the next sample will do */ }
}
function vitals(from: number, to: number): string {
  const s = samples.filter((x) => x.at >= from - 2500 && x.at <= to + 2500);
  if (s.length < 2) return "no readings";
  const a = s[0], z = s[s.length - 1];
  const cpu = z.cpuMs - a.cpuMs, wall = z.at - a.at;
  return "memory " + a.rssMb + " -> peak " + Math.max(...s.map((x) => x.rssMb)) + " -> " + z.rssMb + " MB, CPU " + fmtS(cpu) + " s in " + fmtS(wall) + " s (" + Math.round((cpu / Math.max(1, wall)) * 100) + "% of one core), event-loop lag max " + Math.max(...s.map((x) => x.lagMaxMs)) + " ms";
}

/* ---------------------------------------------------------------- check-in ---- */

const roomFor = (area: string, i: number): string => "9" + area.charAt(0) + String(i).padStart(2, "0");
/** In-house guests: checked in through the server copy, so everything check-in does happens with sending off. */
async function checkIn(hotelId: string, guests: { phone: string; room: string }[]): Promise<{ ok: number; failed: string[] }> {
  let ok = 0; const failed: string[] = [];
  for (const g of guests) {
    let done = false;
    for (let attempt = 0; attempt < 5 && !done; attempt++) {
      try {
        const r = await fetch(base + "/api/checkin", { method: "POST", headers: { "content-type": "application/json", "x-admin-key": KEY }, body: JSON.stringify({ hotelId, room: g.room, roomNumber: g.room, name: "Load Test " + g.room, guestName: "Load Test " + g.room, phone: "+" + g.phone, guestPhone: "+" + g.phone, optIn: false }), signal: AbortSignal.timeout(20000) });
        if (r.status === 429) { await sleep(2000 * (attempt + 1)); continue; }
        if (r.ok) { ok++; done = true; } else { failed.push(g.room + ": " + r.status + " " + (await r.text()).slice(0, 120)); done = true; }
      } catch (e) { if (attempt === 4) failed.push(g.room + ": " + (e instanceof Error ? e.message : String(e))); }
    }
  }
  // the stay reminders check-in schedules must never reach the live scheduler
  try { await prisma.$executeRawUnsafe("update \"ProactiveTrigger\" set status = 'cancelled' where status::text <> 'cancelled' and right(regexp_replace(coalesce(\"guestPhone\"::text,''), '\\D', '', 'g'), 10) = any($1::text[])", guests.map((g) => last10(g.phone))); } catch { /* none scheduled */ }
  return { ok, failed };
}
async function prime(hotelId: string): Promise<void> {
  const rows = await prisma.$queryRawUnsafe<any[]>("select id from \"Message\" where \"hotelId\" = $1 and direction = 'outbound' and \"createdAt\" > now() - interval '60 minutes'", hotelId);
  for (const r of rows) seen.add(String(r.id));
}
/** What Aria actually said most often - the quickest way to see why a question went unanswered or uncovered. */
function commonReplies(guests: Set<string>, n = 2): string[] {
  const counts = new Map<string, number>();
  for (const r of replies) if (guests.has(r.guest) && !isNotice(r.body)) { const k = r.body.replace(/\s+/g, " ").trim().slice(0, 160); counts.set(k, (counts.get(k) ?? 0) + 1); }
  return Array.from(counts.entries()).sort((a, b) => b[1] - a[1]).slice(0, n).map(([t, c]) => "x" + c + "  " + t);
}

/* ---------------------------------------------------------------- the scenarios ---- */

async function scenarioA(phoneId: string): Promise<LtSent[]> {
  const sent: LtSent[] = [];
  await Promise.all(Array.from({ length: GUESTS }, async (_, i) => {
    const guest = phoneFor(AREAS.A, i + 1);
    await sleep(Math.random() * 1500);
    for (let k = 0; k < 3; k++) {
      const t = TOPICS[(i + k) % TOPICS.length];
      const s = await send(phoneId, guest, t.ask, [t.re]); sent.push(s);
      if (!(await waitReply(guest, s.at, TIMEOUT_MS))) break;
      await sleep(1000 + Math.random() * 2000);
    }
  }));
  await settle(sent);
  return sent;
}
async function scenarioB(phoneId: string): Promise<LtSent[]> {
  const sent: LtSent[] = []; const guests = Math.ceil(PEAK / 2); const windowMs = MINUTES * 60000;
  await Promise.all(Array.from({ length: PEAK }, async (_, j) => {
    const g = j % guests, nth = Math.floor(j / guests);
    const t = TOPICS[(g * 2 + nth) % TOPICS.length];
    await sleep(Math.random() * windowMs);
    sent.push(await send(phoneId, phoneFor(AREAS.B, g + 1), t.ask, [t.re]));
  }));
  await settle(sent);
  return sent;
}
async function scenarioC(phoneId: string): Promise<LtSent[]> {
  const sent: LtSent[] = [];
  await Promise.all(Array.from({ length: MULTI_GUESTS }, async (_, i) => {
    await sleep(i * 2000);
    const guest = phoneFor(AREAS.C, i + 1);
    const s = await send(phoneId, guest, MULTI.ask, MULTI.topics); sent.push(s);
    await waitReply(guest, s.at, TIMEOUT_MS);
  }));
  await settle(sent, true);
  return sent;
}

/* ---------------------------------------------------------------- cleanup ---- */

async function cleanup(last10s: string[]): Promise<string> {
  const match = (col: string) => "right(regexp_replace(coalesce(" + col + "::text,''), '\\D', '', 'g'), 10) = any($1::text[])";
  const steps: [string, string][] = [
    ["offers", "delete from offers where " + match("guest_phone")],
    ["test_guests", "delete from test_guests where " + match("phone")],
    ["pending_messages", "delete from pending_messages where " + match("guest_phone")],
    ["reengagements", "delete from reengagements where " + match("guest_phone")],
    ["guest_context", "delete from guest_context where " + match("guest_phone")],
    ["ProactiveTrigger", "delete from \"ProactiveTrigger\" where " + match("\"guestPhone\"")],
    ["Request", "delete from \"Request\" where \"sessionId\" in (select id from \"Session\" where " + match("\"guestPhone\"") + ")"],
    ["order_items", "delete from order_items where order_id in (select id from orders where " + match("guest_phone") + ")"],
    ["orders", "delete from orders where " + match("guest_phone")],
    ["DiningBooking", "delete from \"DiningBooking\" where " + match("\"guestPhone\"")],
    ["ActivityBooking", "delete from \"ActivityBooking\" where " + match("\"guestPhone\"")],
    ["Message", "delete from \"Message\" where " + match("\"guestPhone\"")],
    ["ProcessedMessage", "delete from \"ProcessedMessage\" where \"messageId\" like 'wamid.LOADTEST.%' and $1::text[] is not null"],
    ["GuestConsent", "delete from \"GuestConsent\" where " + match("\"guestPhone\"")],
    ["Session", "delete from \"Session\" where " + match("\"guestPhone\"")],
  ];
  const result = new Map<string, string>();
  for (let pass = 0; pass < 2; pass++) {
    for (const [label, sql] of steps) {
      if (result.has(label) && !result.get(label)!.startsWith("skipped")) continue;
      try { const n = Number(await prisma.$executeRawUnsafe(sql, last10s)); result.set(label, String(n)); }
      catch (e) { const m = (e instanceof Error ? e.message : String(e)).replace(/\s+/g, " "); result.set(label, /does not exist/i.test(m) ? "0" : "skipped (" + m.slice(0, 70) + ")"); }
    }
  }
  const orders = Number(result.get("orders") ?? 0);
  return Array.from(result.entries()).filter(([, v]) => v !== "0").map(([k, v]) => k + " " + v).join(", ") + (orders > 0 ? "\n  NOTE: " + orders + " test order(s) were placed and removed - stock they took is not given back; check the menu stock" : "");
}

/* ---------------------------------------------------------------- main ---- */

/** '"What is the wifi password" x2' from the regex sources analyse reports. */
function topicNames(sources: string[]): string {
  const counts = new Map<string, number>();
  for (const src of sources) { const t = TOPICS.find((x) => x.re.source === src); const k = t ? t.ask.replace(/\?$/, "") : src; counts.set(k, (counts.get(k) ?? 0) + 1); }
  return Array.from(counts.entries()).map(([k, n]) => "\"" + k + "\" x" + n).join(", ");
}

function row(name: string, r: LtResult, extra = ""): string {
  const pad = (s: string, n: number) => (s + " ".repeat(n)).slice(0, n);
  return pad(name, 34) + pad(String(r.sent), 6) + pad(r.acked + "/" + r.sent, 8) + pad(r.processed + "/" + r.sent, 11) + pad(String(r.answered), 10) + pad(r.verified + "/" + r.answered, 10) + pad(String(r.unanswered), 11) + pad(percentile(r.ackMs, 50) + "/" + Math.max(0, ...r.ackMs) + " ms", 14) + pad(fmtS(percentile(r.latenciesMs, 50)) + " / " + fmtS(percentile(r.latenciesMs, 90)) + " / " + fmtS(Math.max(0, ...r.latenciesMs)) + " s", 24) + pad(String(r.orderErrors), 8) + pad(String(r.fallbacks), 10) + extra;
}

async function main(): Promise<number> {
  if (opt("cleanup") === "true") { console.log("cleanup: " + ((await cleanup(allFictional())) || "nothing to delete")); return 0; }
  if (!readFileSync(join("src", "lib", "meta.ts"), "utf8").includes("META_SEND")) { console.log("STOP: src/lib/meta.ts has no META_SEND switch, so the test server could send real messages. Run the round that adds it first."); return 2; }
  if (!HOTEL) {
    const hotels = await prisma.$queryRawUnsafe<any[]>("select \"hotelId\", name, whatsapp_phone_id from \"Hotel\" where \"isActive\" and whatsapp_phone_id is not null order by \"hotelId\"");
    console.log("Pick a hotel: pnpm loadtest --hotel <id>. Active hotels with a WhatsApp number linked:");
    for (const h of hotels) console.log("  " + h.hotelId + "  " + h.name);
    return 1;
  }
  const hotel = (await prisma.$queryRawUnsafe<any[]>("select \"hotelId\", name, whatsapp_phone_id, \"isActive\" from \"Hotel\" where \"hotelId\" = $1", HOTEL))[0];
  if (!hotel) { console.log("No hotel " + HOTEL + "."); return 1; }
  if (!hotel.isActive || !hotel.whatsapp_phone_id) { console.log("Hotel " + HOTEL + " needs to be active with a WhatsApp number linked - the webhook routes by that number."); return 1; }
  const phoneId = String(hotel.whatsapp_phone_id);

  if (await answers(base)) { console.log("Something already answers on port " + PORT + " - pass --port with a free one."); return 1; }
  console.log("Starting a copy of the API on :" + PORT + " with META_SEND=off - nothing can reach WhatsApp ...");
  mkdirSync("loadtest-reports", { recursive: true });
  serverLog = createWriteStream(join("loadtest-reports", "loadtest-" + RUN + "-server.log"));
  child = startServer();
  let ready = false;
  for (let i = 0; i < 90 && !ready; i++) {
    await sleep(1000);
    if (child.exitCode !== null) break;
    ready = await answers(base);
  }
  if (!ready) { console.log("The server copy did not come up. Its last lines:\n  " + tail.join("\n  ")); stopServer(); return 1; }
  const probe = await send(phoneId, phoneFor(AREAS.A, 99), "ping", []);
  if (probe.status === 401) { console.log("The webhook refused the signature (401) - verifyMetaSignature expects a different format. Paste this output."); stopServer(); return 1; }
  await sleep(1500);

  const startTime = Date.now();
  for (const a of Object.values(AREAS)) for (let i = 1; i <= 99; i++) ours.add(last10(phoneFor(a, i)));
  if (!PROSPECTS) {
    const guests: { phone: string; room: string }[] = [];
    if (ONLY.includes("A")) for (let i = 1; i <= GUESTS; i++) guests.push({ phone: phoneFor(AREAS.A, i), room: roomFor(AREAS.A, i) });
    if (ONLY.includes("B")) for (let i = 1; i <= Math.ceil(PEAK / 2); i++) guests.push({ phone: phoneFor(AREAS.B, i), room: roomFor(AREAS.B, i) });
    if (ONLY.includes("C")) for (let i = 1; i <= MULTI_GUESTS; i++) guests.push({ phone: phoneFor(AREAS.C, i), room: roomFor(AREAS.C, i) });
    const ci = await checkIn(hotel.hotelId, guests);
    console.log("Checked in " + ci.ok + "/" + guests.length + " test guests (rooms 92xx, 93xx, 94xx; no opt-in, so no welcome; their stay reminders cancelled)." + (ci.failed.length ? "\n  check-in refused: " + ci.failed.slice(0, 3).join(" | ") + (ci.failed.length > 3 ? " ... " + ci.failed.length + " in all" : "") : ""));
  } else console.log("Prospects: the guests are not checked in.");
  await prime(hotel.hotelId).catch(() => undefined);
  console.log("Load test " + RUN + " - hotel " + hotel.hotelId + " (" + hotel.name + "). The AI answers for real; WhatsApp sending is off.");
  let polling = true;
  const poller = (async () => { while (polling) { try { await pollReplies(hotel.hotelId); } catch { /* next time */ } await sleep(750); } })();
  const sampler = (async () => { while (polling) { await sample(); await sleep(2000); } })();
  runStart = Date.now();

  const results: { name: string; key: string; r: LtResult; from: number; to: number; guests: Set<string> }[] = [];
  const scenarios: [string, string, () => Promise<LtSent[]>][] = [
    ["A", GUESTS + " guests at once, 3 questions", () => scenarioA(phoneId)],
    ["B", "peak " + PEAK + " messages in " + MINUTES + " min", () => scenarioB(phoneId)],
    ["C", MULTI_GUESTS + " multi-question messages", () => scenarioC(phoneId)],
  ];
  for (const [key, name, fn] of scenarios) {
    if (!ONLY.includes(key)) continue;
    console.log("  running " + key + ": " + name + " ...");
    const from = Date.now(); const sent = await fn(); const to = Date.now();
    await pollReplies(hotel.hotelId).catch(() => undefined);
    await markProcessed(sent).catch(() => undefined);
    results.push({ name: key + " " + name, key, r: analyse(sent, replies, FALLBACK), from, to, guests: new Set(sent.map((s) => s.guest)) });
  }
  polling = false; await poller; await sampler;

  console.log("");
  console.log("scenario                          sent  acked   processed  answered  on topic  unanswered ack p50/max    reply p50 / p90 / max   order   fallback");
  for (const x of results) console.log(row(x.name, x.r, x.key === "C" ? "  all 3 questions covered: " + x.r.coverage.filter((c) => c >= 1).length + "/" + x.r.coverage.length : ""));
  console.log("  reply times are measured from this machine: the copy reaches the database and the AI service over the internet, so they include those round trips");
  for (const x of results) if (x.r.notices) console.log("  " + x.key + " privacy notices: " + x.r.notices + " (first contact, " + fmtS(percentile(x.r.noticeMs, 50)) + " s p50) - counted apart, not as answers");
  for (const x of results) console.log("  " + x.key + " server: " + vitals(x.from, x.to));
  for (const x of results) {
    const top = commonReplies(x.guests);
    if (top.length) console.log("  " + x.key + " most common replies:\n      " + top.join("\n      "));
  }
  if (suppressed) console.log("  the server suppressed " + suppressed + " reply(ies) as identical to one sent moments before");
  const problems: string[] = [];
  for (const x of results) {
    const r = x.r;
    if (r.acked < r.sent) problems.push(x.key + ": " + (r.sent - r.acked) + " webhook call(s) not acknowledged with 200");
    if (r.processed < r.sent) problems.push(x.key + ": " + (r.sent - r.processed) + " message(s) never processed (dropped)");
    if (r.unanswered) problems.push(x.key + ": " + r.unanswered + " question(s) with no reply within " + TIMEOUT_MS / 1000 + " s");
    if (r.orderErrors) problems.push(x.key + ": " + r.orderErrors + " reply(ies) out of order");
    if (x.key === "C" && r.coverage.some((c) => c < 1)) problems.push("C: " + r.coverage.filter((c) => c < 1).length + " of " + r.coverage.length + " multi-question message(s) not fully answered - left out: " + topicNames(r.uncovered));
  }
  const warnings = results.filter((x) => x.r.fallbacks).map((x) => x.key + ": " + x.r.fallbacks + " fallback reply(ies) - the AI was not answering (rate limit or error); see the server's log");
  for (const x of results) if (x.r.offTopic.length) warnings.push(x.key + ": " + x.r.offTopic.length + " answer(s) did not mention what was asked, e.g. " + x.r.offTopic.slice(0, 3).join(" | "));
  console.log("");
  console.log(problems.length ? "FAIL\n  " + problems.join("\n  ") : "PASS - no dropped messages, no timeouts, no ordering errors");
  if (warnings.length) console.log("WARN\n  " + warnings.join("\n  "));

  mkdirSync("loadtest-reports", { recursive: true });
  const file = join("loadtest-reports", "loadtest-" + RUN + ".json");
  writeFileSync(file, JSON.stringify({ run: RUN, hotel: hotel.hotelId, startedAt: new Date(startTime).toISOString(), options: { GUESTS, PEAK, MINUTES, MULTI_GUESTS, TIMEOUT_S: TIMEOUT_MS / 1000 }, results: results.map((x) => ({ scenario: x.name, ...x.r, latencyP50Ms: percentile(x.r.latenciesMs, 50), latencyP90Ms: percentile(x.r.latenciesMs, 90), server: vitals(x.from, x.to) })), suppressed, replies: replies.map((r) => ({ guest: r.guest, at: new Date(r.at).toISOString(), body: r.body.slice(0, 400) })), samples, verdict: problems.length ? "FAIL" : "PASS", problems, warnings }, null, 2));
  console.log("report: " + file + " (server log beside it)");
  stopServer();
  if (!KEEP) console.log("cleanup: " + ((await cleanup(Array.from(ours))) || "nothing to delete"));
  else console.log("rows kept (--keep). Remove them later with: pnpm loadtest --cleanup");
  return problems.length ? 3 : 0;
}

process.on("SIGINT", () => { stopServer(); console.log("\nstopped - run pnpm loadtest --cleanup to remove what this run created"); process.exit(130); });
main().then(async (code) => { stopServer(); await prisma.$disconnect().catch(() => undefined); process.exit(code); }).catch(async (e) => { stopServer(); console.error("load test failed:", e instanceof Error ? e.message : e); await prisma.$disconnect().catch(() => undefined); process.exit(1); });
