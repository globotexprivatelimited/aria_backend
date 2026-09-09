import { prisma } from "../db";
import { log } from "../lib/logger";
import { recordMissedDemand } from "../misseddemand/service";
import type { BrainOutput, BrainRequest } from "../brain/schema";

/**
 * The hotel's live catalog - in-room dining menu, restaurant menu and spa services -
 * and the rules that stop Aria from selling anything that is not on it.
 *
 * Two halves:
 *   loadCatalog()  - reads menu_items + dept_items, gives the brain a compact menu with short codes.
 *   applyCatalog() - after the brain has answered, checks every item it named against the database,
 *                    places a real order for what is available, and composes the order summary itself
 *                    so prices in the guest's reply always come from the database, never from the model.
 */

const RUPEE = "\u20B9";
const MAX_SUGGESTIONS = 3;
const STRONG_MATCH = 0.78;   // a "not on menu" ask that actually is on the menu, just spelt differently
const WEAK_MATCH = 0.12;     // below this a suggestion is filler, not a real match

export type CatalogDept = "fb" | "dining" | "spa";

export type CatalogItem = {
  id: string;
  code: string;
  dept: CatalogDept;
  name: string;
  category: string | null;
  kind: string | null;
  diet: string | null;
  price: number;
  stock: number;          // 0 means not tracked
  available: boolean;
  prepMins: number;
  durationMin: number;
  signature: boolean;
  bestseller: boolean;
  ageRestricted: boolean;
  servedFrom: string | null;
  servedTo: string | null;
};

export type Catalog = {
  items: CatalogItem[];
  byCode: Map<string, CatalogItem>;
  promptText: string;
  configured: Record<CatalogDept, boolean>;
  timezone: string | null;
};

/* ---------------------------------------------------------------- loading ---------- */

function num(v: unknown, fallback = 0): number {
  if (v === null || v === undefined) return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}
function str(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s ? s : null;
}
function hhmm(v: unknown): string | null {
  const s = str(v);
  return s ? s.slice(0, 5) : null;
}

export async function loadCatalog(hotelId: string, timezone: string | null): Promise<Catalog> {
  const items: CatalogItem[] = [];
  const counters: Record<CatalogDept, number> = { fb: 0, dining: 0, spa: 0 };
  const prefix: Record<CatalogDept, string> = { fb: "F", dining: "D", spa: "S" };
  const nextCode = (dept: CatalogDept) => prefix[dept] + String(++counters[dept]);

  try {
    const rows = await prisma.$queryRawUnsafe<any[]>(
      `select id, dept, name, category, kind, diet, price, stock, available, prep_mins, is_signature, is_bestseller, age_restricted, available_from, available_to
         from menu_items where hotel_id = $1 and dept in ('fb', 'dining')
        order by dept, category asc nulls last, sort_order asc, name asc`, hotelId);
    for (const r of rows) {
      const dept = (r.dept === "dining" ? "dining" : "fb") as CatalogDept;
      items.push({
        id: String(r.id), code: nextCode(dept), dept, name: String(r.name).trim(), category: str(r.category), kind: str(r.kind),
        diet: str(r.diet), price: num(r.price), stock: num(r.stock), available: r.available !== false,
        prepMins: num(r.prep_mins), durationMin: 0, signature: !!r.is_signature, bestseller: !!r.is_bestseller,
        ageRestricted: !!r.age_restricted, servedFrom: hhmm(r.available_from), servedTo: hhmm(r.available_to),
      });
    }
  } catch (e) {
    log.warn("catalog: menu_items unavailable", { detail: e instanceof Error ? e.message : String(e) });
  }

  try {
    const rows = await prisma.$queryRawUnsafe<any[]>(
      `select id, name, category, kind, price, stock, available, duration_min, is_signature, time_from, time_to
         from dept_items where hotel_id = $1 and dept = 'spa'
        order by sort_order asc, name asc`, hotelId);
    for (const r of rows) {
      items.push({
        id: String(r.id), code: nextCode("spa"), dept: "spa", name: String(r.name).trim(), category: str(r.category), kind: str(r.kind),
        diet: null, price: num(r.price), stock: num(r.stock), available: r.available !== false,
        prepMins: 0, durationMin: num(r.duration_min), signature: !!r.is_signature, bestseller: false,
        ageRestricted: false, servedFrom: hhmm(r.time_from), servedTo: hhmm(r.time_to),
      });
    }
  } catch (e) {
    log.warn("catalog: dept_items unavailable", { detail: e instanceof Error ? e.message : String(e) });
  }

  const byCode = new Map(items.map((i) => [i.code, i]));
  const configured: Record<CatalogDept, boolean> = {
    fb: items.some((i) => i.dept === "fb"),
    dining: items.some((i) => i.dept === "dining"),
    spa: items.some((i) => i.dept === "spa"),
  };
  return { items, byCode, promptText: renderForPrompt(items, timezone), configured, timezone };
}

/* ---------------------------------------------------------------- availability ------ */

function nowHHMM(tz: string | null): string {
  const opts: Intl.DateTimeFormatOptions = { hour: "2-digit", minute: "2-digit", hourCycle: "h23" };
  try {
    return new Intl.DateTimeFormat("en-GB", { ...opts, timeZone: tz ?? undefined }).format(new Date());
  } catch {
    return new Intl.DateTimeFormat("en-GB", opts).format(new Date());
  }
}

function servingNow(item: CatalogItem, tz: string | null): boolean {
  if (!item.servedFrom || !item.servedTo) return true;
  const now = nowHHMM(tz);
  const f = item.servedFrom, t = item.servedTo;
  return f <= t ? now >= f && now <= t : now >= f || now <= t;
}

type Availability = { ok: true } | { ok: false; reason: "sold_out" | "not_served_now" };

function availability(item: CatalogItem, tz: string | null): Availability {
  if (!item.available) return { ok: false, reason: "sold_out" };
  if (!servingNow(item, tz)) return { ok: false, reason: "not_served_now" };
  return { ok: true };
}

/* ---------------------------------------------------------------- prompt ----------- */

function money(n: number): string {
  const v = Math.round(n * 100) / 100;
  return RUPEE + (Number.isInteger(v) ? v.toLocaleString("en-IN") : v.toFixed(2));
}

function to12h(hhmmStr: string): string {
  const [h, m] = hhmmStr.split(":").map((x) => Number(x));
  if (!Number.isFinite(h)) return hhmmStr;
  const suffix = h >= 12 ? "pm" : "am";
  const hour = h % 12 === 0 ? 12 : h % 12;
  return hour + (m ? ":" + String(m).padStart(2, "0") : "") + " " + suffix;
}

function renderForPrompt(items: CatalogItem[], tz: string | null): string {
  if (items.length === 0) return "";
  const sections: string[] = [];
  const block = (dept: CatalogDept, title: string, header: string) => {
    const rows = items.filter((i) => i.dept === dept);
    if (rows.length === 0) return;
    const lines = rows.map((i) => {
      const notes: string[] = [];
      const a = availability(i, tz);
      if (!a.ok && a.reason === "sold_out") notes.push("SOLD OUT");
      if (!a.ok && a.reason === "not_served_now") notes.push("NOT SERVED NOW (" + to12h(i.servedFrom!) + " to " + to12h(i.servedTo!) + ")");
      if (i.bestseller) notes.push("bestseller");
      if (i.signature) notes.push("signature");
      if (i.ageRestricted) notes.push("21+ only");
      if (dept === "spa" && i.durationMin) notes.push(i.durationMin + " min");
      if (dept !== "spa" && i.prepMins) notes.push(i.prepMins + " min");
      return [i.code, i.name, i.category ?? "-", i.diet ?? "-", money(i.price), notes.join(", ") || "-"].join(" | ");
    });
    sections.push(title + " (" + header + ")\n" + lines.join("\n"));
  };
  block("fb", "IN-ROOM DINING MENU", "code | name | category | diet | price | notes");
  block("dining", "RESTAURANT MENU - served in the restaurant, not to rooms", "code | name | category | diet | price | notes");
  block("spa", "SPA SERVICES", "code | name | category | - | price | notes");
  return sections.join("\n\n");
}

/* ---------------------------------------------------------------- matching --------- */

function normalise(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}
function bigrams(s: string): Set<string> {
  const out = new Set<string>();
  const t = s.replace(/\s/g, "");
  for (let i = 0; i < t.length - 1; i++) out.add(t.slice(i, i + 2));
  return out;
}
/** 0..1 similarity between what the guest typed and a catalog name: Dice on bigrams blended with token overlap. */
function similarity(ask: string, name: string): number {
  const a = normalise(ask), b = normalise(name);
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (b.includes(a) || a.includes(b)) return 0.9;
  const ba = bigrams(a), bb = bigrams(b);
  let common = 0;
  for (const g of ba) if (bb.has(g)) common++;
  const dice = (2 * common) / (ba.size + bb.size || 1);
  const ta = new Set(a.split(" ")), tb = new Set(b.split(" "));
  let shared = 0;
  for (const t of ta) if (tb.has(t)) shared++;
  const jaccard = shared / (new Set([...ta, ...tb]).size || 1);
  return Math.max(dice, jaccard);
}

const NONVEG = ["mutton", "lamb", "goat", "chicken", "murgh", "fish", "prawn", "prawns", "shrimp", "crab", "egg", "eggs", "keema", "beef", "pork", "bacon", "ham", "tandoori", "kebab", "kabab", "seekh", "biryani"];
const VEG = ["paneer", "veg", "vegetable", "dal", "daal", "aloo", "gobi", "bhindi", "mushroom", "tofu", "chana", "rajma", "palak", "salad"];

function inferDiet(ask: string): "nonveg" | "veg" | null {
  const a = " " + normalise(ask) + " ";
  if (NONVEG.some((w) => a.includes(" " + w + " "))) return "nonveg";
  if (VEG.some((w) => a.includes(" " + w + " "))) return "veg";
  return null;
}
function dietMatches(pref: "nonveg" | "veg" | null, item: CatalogItem): boolean {
  if (!pref || !item.diet) return false;
  const d = item.diet.toLowerCase();
  return pref === "nonveg" ? d.includes("non") || d === "egg" : !d.includes("non") && d !== "egg";
}

function bestMatch(ask: string, candidates: CatalogItem[]): { item: CatalogItem; score: number } | null {
  let best: { item: CatalogItem; score: number } | null = null;
  for (const item of candidates) {
    const score = similarity(ask, item.name);
    if (!best || score > best.score) best = { item, score };
  }
  return best;
}

const DRINK = ["chai", "tea", "coffee", "juice", "water", "soda", "lassi", "milk", "cola", "coke", "beer", "wine", "whisky", "whiskey", "cocktail", "mocktail", "shake", "smoothie"];

function inferKind(ask: string): "drink" | null {
  const a = " " + normalise(ask) + " ";
  return DRINK.some((w) => a.includes(" " + w + " ")) ? "drink" : null;
}

/**
 * Up to three alternatives for something we cannot serve. Real matches first (a similar name, or
 * the same category as the item they wanted), then the house favourites of the right diet, then
 * whatever ranks best - so the guest always gets three, and the good ones come first.
 */
function suggest(ask: string, dept: CatalogDept, catalog: Catalog, exclude: Set<string>, anchor: CatalogItem | null): CatalogItem[] {
  const pref = inferDiet(ask);
  const kind = anchor?.kind ?? inferKind(ask);
  const pool = catalog.items.filter((i) => i.dept === dept && !exclude.has(i.id) && availability(i, catalog.timezone).ok);
  const scored = pool.map((item) => {
    const sim = similarity(ask, item.name);
    let score = sim;
    const sameCategory = !!(anchor && anchor.category && item.category === anchor.category);
    if (sameCategory) score += 0.15;
    if (anchor && anchor.diet && item.diet === anchor.diet) score += 0.1;
    if (dietMatches(pref, item)) score += 0.2;
    if (kind && item.kind === kind) score += 0.15;
    if (item.bestseller) score += 0.05;
    if (item.signature) score += 0.05;
    return { item, score, real: sim >= WEAK_MATCH || sameCategory };
  });
  scored.sort((a, b) => b.score - a.score);
  const picked: CatalogItem[] = [];
  const take = (list: typeof scored) => {
    for (const s of list) {
      if (picked.length >= MAX_SUGGESTIONS) break;
      if (!picked.some((p) => p.id === s.item.id)) picked.push(s.item);
    }
  };
  take(scored.filter((s) => s.real));
  take(scored.filter((s) => (s.item.bestseller || s.item.signature) && (!pref || dietMatches(pref, s.item))));
  take(scored);
  return picked;
}

/* ---------------------------------------------------------------- applying --------- */

type Ask = { text: string; qty: number; code?: string };
type Confirmed = { item: CatalogItem; qty: number };
type Unavailable = { ask: string; item: CatalogItem | null; reason: "sold_out" | "not_served_now" | "not_on_menu"; suggestions: CatalogItem[] };

function asksFrom(r: BrainRequest, dept: CatalogDept, catalog: Catalog): Ask[] {
  const asks: Ask[] = [];
  for (const it of r.items ?? []) asks.push({ text: it.name, qty: Math.max(1, it.qty ?? 1), code: it.id });
  for (const n of r.notOnMenu ?? []) asks.push({ text: n, qty: 1 });
  if (asks.length > 0) return asks;
  // the brain gave us prose only - recognise catalog names inside it, else treat the whole detail as one ask
  const detail = normalise(r.detail);
  for (const item of catalog.items) {
    if (item.dept === dept && detail.includes(normalise(item.name))) asks.push({ text: item.name, qty: r.quantity ?? 1, code: item.code });
  }
  if (asks.length === 0 && r.detail.trim()) asks.push({ text: r.detail.trim(), qty: r.quantity ?? 1 });
  return asks;
}

function resolveAsks(asks: Ask[], dept: CatalogDept, catalog: Catalog): { confirmed: Confirmed[]; unavailable: Unavailable[] } {
  const confirmed: Confirmed[] = [];
  const unavailable: Unavailable[] = [];
  const pool = catalog.items.filter((i) => i.dept === dept);
  for (const ask of asks) {
    let item: CatalogItem | null = ask.code ? catalog.byCode.get(ask.code) ?? null : null;
    if (item && item.dept !== dept) item = null;
    if (!item) {
      const m = bestMatch(ask.text, pool);
      if (m && m.score >= STRONG_MATCH) item = m.item;
    }
    if (!item) {
      const near = bestMatch(ask.text, pool);
      const anchor = near && near.score >= WEAK_MATCH ? near.item : null;
      unavailable.push({ ask: ask.text, item: null, reason: "not_on_menu", suggestions: suggest(ask.text, dept, catalog, new Set(), anchor) });
      continue;
    }
    const a = availability(item, catalog.timezone);
    if (!a.ok) {
      unavailable.push({ ask: ask.text, item, reason: a.reason, suggestions: suggest(item.name, dept, catalog, new Set([item.id]), item) });
      continue;
    }
    const qty = item.stock > 0 ? Math.min(ask.qty, item.stock) : ask.qty;
    const existing = confirmed.find((c) => c.item.id === item!.id);
    if (existing) existing.qty += qty; else confirmed.push({ item, qty });
  }
  return { confirmed, unavailable };
}

/** Race-safe stock decrement via the decrement_stock() function; falls back to a plain update if it is missing. */
async function takeStock(item: CatalogItem, qty: number): Promise<boolean> {
  if (item.stock <= 0) return true; // not tracked
  try {
    const rows = await prisma.$queryRawUnsafe<any[]>(`select ok, new_stock, low from decrement_stock($1::uuid, $2::int)`, item.id, qty);
    const r = rows[0];
    if (!r) return false;
    if (r.low) log.warn("catalog: low stock", { item: item.name, remaining: num(r.new_stock) });
    return !!r.ok;
  } catch {
    try {
      const n = await prisma.$executeRawUnsafe(
        `update menu_items set stock = stock - $2, available = case when stock - $2 <= 0 then false else available end where id = $1::uuid and stock >= $2`, item.id, qty);
      return Number(n) > 0;
    } catch { return true; }
  }
}

async function placeOrder(hotelId: string, room: string | null, guestPhone: string, confirmed: Confirmed[]): Promise<string | null> {
  const total = confirmed.reduce((s, c) => s + c.item.price * c.qty, 0);
  try {
    const rows = await prisma.$queryRawUnsafe<any[]>(
      `insert into orders (hotel_id, dept, room, guest_phone, status, total) values ($1, 'fb', $2, $3, 'placed', $4) returning id`,
      hotelId, room, guestPhone, Math.round(total * 100) / 100);
    const orderId = rows[0]?.id ? String(rows[0].id) : null;
    if (orderId) {
      for (const c of confirmed) {
        await prisma.$executeRawUnsafe(
          `insert into order_items (order_id, menu_item_id, name, unit_price, qty) values ($1::uuid, $2::uuid, $3, $4, $5)`,
          orderId, c.item.id, c.item.name, c.item.price, c.qty);
      }
    }
    return orderId;
  } catch (e) {
    log.warn("catalog: order not persisted", { detail: e instanceof Error ? e.message : String(e) });
    return null;
  }
}

function reasonText(u: Unavailable): string {
  const name = u.item ? u.item.name : u.ask;
  if (u.reason === "sold_out") return name + " is sold out today.";
  if (u.reason === "not_served_now" && u.item?.servedFrom && u.item?.servedTo) {
    return name + " is served " + to12h(u.item.servedFrom) + " to " + to12h(u.item.servedTo) + ".";
  }
  return "Sorry, " + name + " is not on our menu.";
}

function suggestionText(items: CatalogItem[], dept: CatalogDept): string {
  if (items.length === 0) return "";
  const parts = items.map((i) => i.name + " (" + money(i.price) + (dept === "spa" && i.durationMin ? ", " + i.durationMin + " min" : "") + ")");
  return " Closest we have: " + parts.join(", ") + ". Just tell me which you would like.";
}

function foodSummary(room: string | null, confirmed: Confirmed[], unavailable: Unavailable[]): string {
  const lines: string[] = [];
  if (confirmed.length) {
    lines.push("Your order" + (room ? " for Room " + room : "") + ":");
    for (const c of confirmed) lines.push("- " + c.qty + " x " + c.item.name + " - " + money(c.item.price * c.qty));
    const total = confirmed.reduce((s, c) => s + c.item.price * c.qty, 0);
    const prep = Math.max(0, ...confirmed.map((c) => c.item.prepMins));
    lines.push("Total " + money(total) + (prep ? ". About " + prep + " minutes." : "."));
  }
  for (const u of unavailable) lines.push((lines.length ? "\n" : "") + reasonText(u) + suggestionText(u.suggestions, "fb"));
  return lines.join("\n");
}

function spaSummary(confirmed: Confirmed[], unavailable: Unavailable[]): string {
  const lines: string[] = [];
  if (confirmed.length) {
    lines.push("Spa request noted:");
    for (const c of confirmed) lines.push("- " + c.item.name + " (" + money(c.item.price) + (c.item.durationMin ? ", " + c.item.durationMin + " min" : "") + ")");
    lines.push("The spa team will confirm your time shortly.");
  }
  for (const u of unavailable) lines.push((lines.length ? "\n" : "") + reasonText(u) + suggestionText(u.suggestions, "spa"));
  return lines.join("\n");
}

async function noteMissed(hotelId: string, dept: CatalogDept, room: string | null, guestPhone: string, unavailable: Unavailable[]): Promise<void> {
  for (const u of unavailable) {
    await recordMissedDemand({
      hotelId, roomNumber: room, guestPhone, department: dept, requestedItem: u.ask, source: "not_offered",
      declineReason: u.reason === "sold_out" ? "sold out" : u.reason === "not_served_now" ? "outside serving hours" : "not on menu",
    });
  }
}

/**
 * Check the brain's answer against the catalog. Everything the guest asked to eat or drink is
 * resolved as ONE order (however many requests the brain split it into); things the hotel does not
 * offer are dropped and logged as missed demand; confirmed items become an order with real prices;
 * the guest's reply gets the exact summary appended. Departments with no catalog are left untouched.
 */
export async function applyCatalog(
  output: BrainOutput,
  catalog: Catalog,
  hotelId: string,
  session: { roomNumber?: string | null },
  guestPhone: string,
  opts: { dryRun?: boolean } = {}
): Promise<BrainOutput> {
  const room = session.roomNumber ?? null;
  const kept: BrainRequest[] = [];
  const summaries: string[] = [];
  const foodRequests = output.requests.filter((r) => r.intent === "room_service" && catalog.configured.fb);
  const spaRequests = output.requests.filter((r) => r.intent === "spa" && catalog.configured.spa);

  for (const r of output.requests) {
    if (!foodRequests.includes(r) && !spaRequests.includes(r)) kept.push(r);
  }

  if (foodRequests.length) {
    const asks = foodRequests.flatMap((r) => asksFrom(r, "fb", catalog));
    const { confirmed, unavailable } = resolveAsks(asks, "fb", catalog);
    // stock is claimed item by item; anything that has just run out moves to the unavailable list
    const placed: Confirmed[] = [];
    for (const c of confirmed) {
      if (opts.dryRun || (await takeStock(c.item, c.qty))) placed.push(c);
      else unavailable.push({ ask: c.item.name, item: c.item, reason: "sold_out", suggestions: suggest(c.item.name, "fb", catalog, new Set([c.item.id]), c.item) });
    }
    if (placed.length) {
      const orderId = opts.dryRun ? null : await placeOrder(hotelId, room, guestPhone, placed);
      const total = placed.reduce((s, c) => s + c.item.price * c.qty, 0);
      const first = foodRequests[0];
      kept.push({
        ...first,
        detail: "Room service order: " + placed.map((c) => c.qty + " x " + c.item.name).join(", ") + " (total " + money(total) + (orderId ? ", order " + orderId.slice(0, 8) : "") + ")",
        quantity: placed.reduce((s, c) => s + c.qty, 0),
        priority: foodRequests.some((r) => r.priority === "urgent") ? "urgent" : first.priority,
      });
    }
    if (unavailable.length && !opts.dryRun) await noteMissed(hotelId, "fb", room, guestPhone, unavailable);
    summaries.push(foodSummary(room, placed, unavailable));
    log.info("catalog: room service resolved", { placed: placed.length, unavailable: unavailable.length, phone: guestPhone });
  }

  if (spaRequests.length) {
    const asks = spaRequests.flatMap((r) => asksFrom(r, "spa", catalog));
    const { confirmed, unavailable } = resolveAsks(asks, "spa", catalog);
    if (confirmed.length) {
      const first = spaRequests[0];
      const when = spaRequests.map((r) => r.whenText).find(Boolean);
      kept.push({
        ...first,
        detail: "Spa: " + confirmed.map((c) => c.item.name + " (" + money(c.item.price) + (c.item.durationMin ? ", " + c.item.durationMin + " min" : "") + ")").join(", ") + (when ? " - " + when : ""),
      });
    }
    if (unavailable.length && !opts.dryRun) await noteMissed(hotelId, "spa", room, guestPhone, unavailable);
    summaries.push(spaSummary(confirmed, unavailable));
    log.info("catalog: spa resolved", { confirmed: confirmed.length, unavailable: unavailable.length, phone: guestPhone });
  }

  const extra = summaries.filter(Boolean).join("\n\n");
  const reply = extra ? output.reply.trim() + "\n\n" + extra : output.reply;
  return { ...output, requests: kept, reply };
}
