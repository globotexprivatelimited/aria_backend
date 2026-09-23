import { cancelOrder, cancelLatestOrder } from "../menu/orders";
import type Anthropic from "@anthropic-ai/sdk";
import { bookSlot } from "../slots/service";
import { log } from "../lib/logger";
import type { BrainRequest } from "../brain/schema";
import {
  localDate, niceDate, parseWhen, to12h, relDate, minutesOf, money, joinNatural, daysText, within,
  resolveAsks, slotOffers, takeStock, placeOrder, tablesTaken, noteMissed, matchMaintenance,
  type Catalog, type CatalogItem, type CatalogDept, type Confirmed, type Unavailable,
} from "../menu/catalog";

/**
 * What Aria can actually do, as tools Claude calls. Reading needs no tool - the menu, prices, the spa
 * schedule and the weather are all in the prompt. Acting does: every order, booking and request goes
 * through one of these, which check the catalogue and the live availability and refuse anything that is
 * not real. Whatever a tool does is recorded in ctx.filed for the department boards.
 */

/** Something already with the teams for this guest: a request, an order, a booking. */
export type DoneAction = { intent: string; detail: string; minutesAgo: number; status: string };

export type AgentContext = {
  hotelId: string;
  catalog: Catalog;
  room: string | null;
  guestName: string | null;
  guestPhone: string;
  deptModes: Record<string, string>;
  dryRun: boolean;
  filed: BrainRequest[];
  /** what is already with the teams for this guest, so nothing is done twice */
  doneAlready: DoneAction[];
};

export const AGENT_TOOLS: Anthropic.Tool[] = [
  {
    name: "get_spa_slots",
    description: "The real free times for a spa treatment over the next days. Call this before offering or confirming any spa time - the schedule in the prompt is the usual hours, not what is free.",
    input_schema: {
      type: "object",
      properties: {
        treatment: { type: "string", description: "The treatment as the guest named it, e.g. facial" },
        date: { type: "string", description: "today, tomorrow or YYYY-MM-DD. Omit for the next three days." },
      },
      required: ["treatment"],
    },
  },
  {
    name: "book_spa_slot",
    description: "Reserve a spa treatment at a time the guest has clearly chosen. The time must be free right now or the tool refuses and returns the free times instead. Never call this for a question about a time - only for a choice.",
    input_schema: {
      type: "object",
      properties: {
        treatment: { type: "string" },
        date: { type: "string", description: "today, tomorrow or YYYY-MM-DD" },
        start: { type: "string", description: "Start time, 24-hour HH:MM" },
        note: { type: "string", description: "Any preference in the guest's own words: male therapist, allergy, pregnancy" },
      },
      required: ["treatment", "date", "start"],
    },
  },
  {
    name: "place_order",
    description: "Place an in-room dining order. Returns exactly what was placed with prices and the total, and anything that could not be - sold out, not on the menu, or ambiguous with the options to ask about.",
    input_schema: {
      type: "object",
      properties: {
        items: {
          type: "array",
          items: { type: "object", properties: { name: { type: "string", description: "Dish or drink as the guest named it" }, qty: { type: "integer" } }, required: ["name"] },
        },
      },
      required: ["items"],
    },
  },
  {
    name: "request_table",
    description: "Request a restaurant table. Needs the party size and a time; checks the restaurant's hours and whether that sitting is full.",
    input_schema: {
      type: "object",
      properties: {
        party_size: { type: "integer" },
        date: { type: "string", description: "today, tomorrow or YYYY-MM-DD. Omit for today." },
        time: { type: "string", description: "24-hour HH:MM" },
      },
      required: ["party_size", "time"],
    },
  },
  {
    name: "cancel_order",
    description: "Cancel the guest's most recent room-service order, or a specific one, when they no longer want it or ordered twice. Succeeds only if the kitchen has not started; then the stock goes back and the kitchen is told. Tell the guest exactly what the result says.",
    input_schema: { type: "object", properties: { order_id: { type: "string", description: "the order id shown under ALREADY DONE when the guest means a specific order; omit for their latest" }, reason: { type: "string" } } },
  },
  {
    name: "file_request",
    description: "Send a request to a hotel team: housekeeping (towels, cleaning, amenities), maintenance (anything broken), front_desk (bills, checkout, transport, general help), concierge (recommendations, anything else, and every cancellation or complaint), activities (tours, experiences). Returns which team has it and what they promise.",
    input_schema: {
      type: "object",
      properties: {
        department: { type: "string", enum: ["housekeeping", "maintenance", "front_desk", "concierge", "activities", "spa"] },
        detail: { type: "string", description: "Exactly what is wanted, in full, including any preference in the guest's own words" },
        priority: { type: "string", enum: ["normal", "urgent", "human_required", "emergency"], description: "urgent when the guest is inconvenienced right now; human_required for complaints, refunds, billing, cancellations or anything needing a person's judgement" },
        quantity: { type: "integer" },
        when: { type: "string", description: "The date or time the guest mentioned, exactly as they said it" },
      },
      required: ["department", "detail"],
    },
  },
];

/* ---------------------------------------------------------------- helpers ---------- */

const str = (v: unknown, max = 300): string => (typeof v === "string" ? v.trim().slice(0, max) : "");
const int = (v: unknown, lo: number, hi: number, fallback: number): number => {
  const n = typeof v === "string" ? Number(v) : v;
  return typeof n === "number" && isFinite(n) ? Math.min(hi, Math.max(lo, Math.round(n))) : fallback;
};
const modeOf = (ctx: AgentContext, dept: string): string =>
  ctx.deptModes[dept] ?? (dept === "fb" || dept === "housekeeping" ? "auto" : dept === "maintenance" ? "maintenance" : "accept_decline");
const plain = (s: string): string => s.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();

const tokens = (s: string) => new Set(plain(s).split(" ").filter((w) => w.length >= 3));
/** The same ask in different words: the words they share outweigh the words they do not. */
export function isNearDuplicate(a: string, b: string): boolean {
  const ta = tokens(a), tb = tokens(b);
  if (!ta.size || !tb.size) return false;
  let shared = 0;
  for (const w of ta) if (tb.has(w)) shared++;
  return shared >= 2 && shared / (ta.size + tb.size - shared) >= 0.5;
}
function alreadyDone(ctx: AgentContext, intent: string, detail: string, withinMinutes: number): DoneAction | null {
  return ctx.doneAlready.find((d) => d.intent === intent && d.minutesAgo <= withinMinutes && isNearDuplicate(d.detail, detail)) ?? null;
}

function resolveDate(word: string, tz: string | null, now: Date): string | null {
  const w = word.trim().toLowerCase();
  if (!w || w === "today" || w === "aaj" || w === "aj") return localDate(tz, now);
  if (w === "tomorrow" || w === "kal") return localDate(tz, now, 1);
  if (/^\d{4}-\d{2}-\d{2}$/.test(w)) return w;
  return parseWhen(w, tz, now, {}).date ?? null;
}

function resolveTime(word: string, tz: string | null, now: Date): string | null {
  const w = word.trim();
  const m = /^(\d{1,2})(?::(\d{2}))?$/.exec(w);
  if (m) {
    const h = Number(m[1]);
    if (h >= 0 && h <= 23) return String(h).padStart(2, "0") + ":" + (m[2] ?? "00");
  }
  return parseWhen(w, tz, now, { assumePm: true }).time ?? null;
}

const describe = (i: CatalogItem) => ({ name: i.name, duration_min: i.durationMin || null, price: money(i.price) });
const listNames = (items: CatalogItem[]) => items.map((i) => i.name + " " + money(i.price));

function spaItem(ctx: AgentContext, treatment: string): { item: CatalogItem | null; error?: Record<string, unknown> } {
  const { catalog } = ctx;
  if (!catalog.configured.spa) return { item: null, error: { ok: false, error: "this hotel has no spa list published" } };
  const { confirmed, ambiguous } = resolveAsks([{ text: treatment || "treatment", qty: 1 }], "spa", catalog);
  if (ambiguous.length) return { item: null, error: { ok: false, error: "more than one treatment matches - ask the guest which", options: listNames(ambiguous[0].options) } };
  if (!confirmed.length) {
    const all = catalog.items.filter((i) => i.dept === "spa" && i.available);
    return { item: null, error: { ok: false, error: "no such treatment on the spa list", treatments: listNames(all) } };
  }
  return { item: confirmed[0].item };
}

function scheduleOf(catalog: Catalog, item: CatalogItem): string[] {
  return catalog.slots
    .filter((s) => s.dept === "spa" && s.active && (s.itemId === item.id || s.itemId === null))
    .map((s) => String(s.startTime).slice(0, 5) + (s.endTime ? " to " + String(s.endTime).slice(0, 5) : "") + (s.days.length ? " (" + daysText(s.days) + ")" : ""));
}

const offerView = (o: { date: string; start: string }, tz: string | null, now: Date) => ({ date: o.date, day: relDate(o.date, tz, now), start: o.start, start_12h: to12h(o.start) });

const reasonText = (u: Unavailable): string => (u.reason === "sold_out" ? "sold out today" : u.reason === "not_served_now" ? "not served at this hour" : "not on the menu");

/* ---------------------------------------------------------------- tools ------------ */

async function getSpaSlots(input: Record<string, unknown>, ctx: AgentContext): Promise<unknown> {
  const { catalog } = ctx;
  const tz = catalog.timezone, now = catalog.now;
  const found = spaItem(ctx, str(input.treatment));
  if (!found.item) return found.error;
  const item = found.item;
  const schedule = scheduleOf(catalog, item);
  if (!schedule.length) return { ok: true, treatment: describe(item), fixed_times: false, note: "no fixed times - take the guest's preferred time and call book_spa_slot; the spa team confirms it" };
  const dateWord = str(input.date);
  const one = dateWord ? resolveDate(dateWord, tz, now) : null;
  if (dateWord && !one) return { ok: false, error: "could not read that date - use today, tomorrow or YYYY-MM-DD" };
  const dates = one ? [one] : [localDate(tz, now), localDate(tz, now, 1), localDate(tz, now, 2)];
  const offers = await slotOffers(ctx.hotelId, catalog, item, dates);
  return {
    ok: true,
    treatment: describe(item),
    schedule,
    free: offers.slice(0, 8).map((o) => offerView(o, tz, now)),
    ...(offers.length ? {} : { note: one ? "nothing free on " + relDate(one, tz, now) + " - try other dates" : "nothing free in the next three days - the spa team can be asked via file_request" }),
  };
}

async function bookSpaSlot(input: Record<string, unknown>, ctx: AgentContext): Promise<unknown> {
  const { catalog } = ctx;
  const tz = catalog.timezone, now = catalog.now;
  const found = spaItem(ctx, str(input.treatment));
  if (!found.item) return found.error;
  const item = found.item;
  const note = str(input.note, 160);
  const label = item.name + " (" + (item.durationMin ? item.durationMin + " min, " : "") + money(item.price) + ")";
  const noteText = note ? " - guest note: " + note : "";
  const priorBooking = ctx.doneAlready.find((d) => d.intent === "spa" && d.minutesAgo <= 12 * 60 && d.detail.includes(item.name) && /slot reserved|team to confirm/.test(d.detail));
  if (priorBooking) return { ok: true, already_booked: true, booking: priorBooking.detail, booked_minutes_ago: priorBooking.minutesAgo, note: "already booked - do not book again; tell the guest it is in hand, and only book another if they clearly want a second one" };
  if (!scheduleOf(catalog, item).length) {
    const when = [str(input.date), str(input.start)].filter(Boolean).join(" ");
    ctx.filed.push({ intent: "spa", detail: "Spa: " + label + noteText + (when ? " - " + when : ""), priority: "normal", whenText: when || undefined });
    return { ok: true, booked: false, requested: true, treatment: describe(item), when: when || null, status: "the spa team will confirm the time" };
  }
  const date = resolveDate(str(input.date), tz, now);
  const start = resolveTime(str(input.start), tz, now);
  if (!date || !start) return { ok: false, error: "need a date (today, tomorrow or YYYY-MM-DD) and a 24-hour start time HH:MM" };
  const offers = await slotOffers(ctx.hotelId, catalog, item, [date]);
  const hit = offers.find((o) => Math.abs(minutesOf(o.start) - minutesOf(start)) <= 30);
  if (!hit) {
    const alt = offers.length ? offers : await slotOffers(ctx.hotelId, catalog, item, [localDate(tz, now, 1), localDate(tz, now, 2), localDate(tz, now, 3)]);
    return { ok: false, error: to12h(start) + " " + relDate(date, tz, now) + " is not free for the " + item.name, free: alt.slice(0, 6).map((o) => offerView(o, tz, now)) };
  }
  const booked = ctx.dryRun ? { ok: true } : await bookSlot({ hotelId: ctx.hotelId, slotId: hit.slotId, onDate: hit.date, roomNumber: ctx.room ?? undefined, guestName: ctx.guestName ?? undefined, guestPhone: ctx.guestPhone, partySize: 1, note: item.name + noteText });
  if (!booked.ok) return { ok: false, error: "that time was just taken - offer another", free: offers.filter((o) => o.slotId !== hit.slotId).slice(0, 6).map((o) => offerView(o, tz, now)) };
  const whenNice = niceDate(hit.date) + " at " + to12h(hit.start);
  ctx.filed.push({ intent: "spa", detail: "Spa: " + label + noteText + " - " + whenNice + " (slot reserved)", priority: "normal", whenText: whenNice });
  return { ok: true, booked: true, treatment: describe(item), when: whenNice, date: hit.date, start: hit.start, status: modeOf(ctx, "spa") === "auto" ? "booked" : "reserved - the spa team will confirm", note_passed_to_team: note || null };
}

async function placeOrderTool(input: Record<string, unknown>, ctx: AgentContext): Promise<unknown> {
  const { catalog } = ctx;
  if (!catalog.configured.fb) return { ok: false, error: "in-room dining is not set up at this hotel - use file_request to the front desk" };
  const raw = Array.isArray(input.items) ? input.items : [];
  const asks = raw.map((it) => ({ text: str((it as { name?: unknown }).name, 80), qty: int((it as { qty?: unknown }).qty, 1, 20, 1) })).filter((a) => a.text);
  if (!asks.length) return { ok: false, error: "no items given" };
  const prior = alreadyDone(ctx, "room_service", "Room service order: " + asks.map((a) => a.qty + " x " + a.text).join(", "), 45);
  if (prior) return { ok: true, already_placed: true, order: prior.detail, placed_minutes_ago: prior.minutesAgo, note: "this order was already placed - do not place it again; tell the guest it is on its way, and only order more if they clearly want more" };
  const { confirmed, unavailable, ambiguous } = resolveAsks(asks, "fb", catalog);
  const placed: Confirmed[] = [];
  for (const c of confirmed) {
    if (ctx.dryRun || (await takeStock(c.item, c.qty))) placed.push(c);
    else unavailable.push({ ask: c.item.name, item: c.item, reason: "sold_out", suggestions: [] });
  }
  const total = placed.reduce((s, c) => s + c.item.price * c.qty, 0);
  let orderId: string | null = null;
  if (placed.length) {
    orderId = ctx.dryRun ? null : await placeOrder(ctx.hotelId, ctx.room, ctx.guestPhone, placed);
    ctx.filed.push({
      intent: "room_service",
      detail: "Room service order: " + placed.map((c) => c.qty + " x " + c.item.name).join(", ") + " (total " + money(total) + (orderId ? ", order " + orderId.slice(0, 8) : "") + ")",
      quantity: placed.reduce((s, c) => s + c.qty, 0),
      priority: "normal",
    });
  }
  if (unavailable.length && !ctx.dryRun) await noteMissed(ctx.hotelId, "fb", ctx.room, ctx.guestPhone, unavailable);
  const prep = placed.reduce((m, c) => Math.max(m, c.item.prepMins), 0);
  return {
    ok: placed.length > 0,
    placed: placed.map((c) => ({ name: c.item.name, qty: c.qty, ...(c.wanted && c.wanted > c.qty ? { asked_for: c.wanted, note: "only " + c.qty + " left" } : {}), unit_price: money(c.item.price), line_total: money(c.item.price * c.qty) })),
    total: money(total),
    room: ctx.room,
    ...(prep ? { ready_in_minutes: prep } : {}),
    status: modeOf(ctx, "fb") === "auto" ? "placed with the kitchen" : "sent to the kitchen - they will confirm",
    unavailable: unavailable.map((u) => ({ asked: u.ask, reason: reasonText(u), instead: listNames(u.suggestions.slice(0, 3)) })),
    ambiguous: ambiguous.map((a) => ({ asked: a.ask, options: listNames(a.options) })),
  };
}

async function requestTable(input: Record<string, unknown>, ctx: AgentContext): Promise<unknown> {
  const { catalog } = ctx;
  const tz = catalog.timezone, now = catalog.now;
  const diningItems = catalog.items.filter((i) => i.dept === "dining" && (i.kind === "table" || i.kind === "sitting"));
  const sittings = diningItems.filter((i) => i.kind === "sitting" && i.available);
  const tables = diningItems.filter((i) => i.kind === "table" && i.available);
  const partySize = int(input.party_size, 1, 50, 0);
  const time = resolveTime(str(input.time), tz, now);
  if (!partySize || !time) return { ok: false, error: "need the party size and a 24-hour time HH:MM" };
  const date = resolveDate(str(input.date), tz, now) ?? localDate(tz, now);
  const hoursText = sittings.length ? joinNatural(sittings.map((s) => s.name + " " + (s.servedFrom && s.servedTo ? to12h(s.servedFrom) + " to " + to12h(s.servedTo) : ""))) : "";
  const sitting = time && sittings.length ? sittings.find((s) => within(s.servedFrom, s.servedTo, time)) ?? null : null;
  if (sittings.length && !sitting) return { ok: false, error: "the restaurant is not open at " + to12h(time), hours: hoursText };
  const suitable = tables.filter((t) => t.seats >= partySize).reduce((s, t) => s + Math.max(1, t.stock), 0);
  const taken = tables.length && !ctx.dryRun ? await tablesTaken(ctx.hotelId, date, sitting) : 0;
  if (tables.length && suitable > 0 && taken >= suitable) {
    const others = sittings.filter((s) => s !== sitting);
    return { ok: false, error: "fully booked for " + (sitting ? sitting.name + " " : "") + relDate(date, tz, now), other_sittings: others.map((s) => s.name + " " + (s.servedFrom ? to12h(s.servedFrom) : "") + (s.servedTo ? " to " + to12h(s.servedTo) : "")) };
  }
  const largest = tables.reduce((m, t) => Math.max(m, t.seats), 0);
  const bigParty = tables.length > 0 && partySize > largest;
  const whenNice = niceDate(date) + " at " + to12h(time);
  ctx.filed.push({ intent: "dining", quantity: partySize, whenText: whenNice + " (" + date + " " + time + ")", priority: "normal", detail: "Table for " + partySize + " - " + whenNice + (sitting ? " (" + sitting.name + ")" : "") + (bigParty ? " - larger than our biggest table (" + largest + "), needs arranging" : "") });
  return { ok: true, party_size: partySize, when: whenNice, sitting: sitting ? sitting.name : null, status: modeOf(ctx, "dining") === "auto" ? "booked" : "requested - the restaurant will confirm", ...(bigParty ? { note: "larger than the biggest table (" + largest + " seats) - the team will arrange seating" } : {}) };
}

const TEAM_LABEL: Record<string, string> = { housekeeping: "housekeeping", maintenance: "maintenance", front_desk: "front desk", concierge: "concierge", activities: "activities", spa: "spa" };

async function fileRequest(input: Record<string, unknown>, ctx: AgentContext): Promise<unknown> {
  const { catalog } = ctx;
  const dept = str(input.department, 20);
  const detail = str(input.detail, 500);
  if (!TEAM_LABEL[dept] || !detail) return { ok: false, error: "need a department and a detail" };
  const priority = (["normal", "urgent", "human_required", "emergency"] as const).find((p) => p === str(input.priority, 20)) ?? "normal";
  const quantity = int(input.quantity, 1, 100, 0) || undefined;
  const when = str(input.when, 120) || undefined;
  const intentOf = (d: string): string => (d === "front_desk" ? "concierge" : d === "housekeeping" || d === "maintenance" || d === "activities" || d === "spa" ? d : "concierge");
  const prior = alreadyDone(ctx, intentOf(dept), detail, 12 * 60);
  if (prior && (priority === "normal" || prior.status.toLowerCase().includes("urgent"))) return { ok: true, already_filed: true, team: TEAM_LABEL[dept], request: prior.detail, filed_minutes_ago: prior.minutesAgo, status: prior.status, note: "already with the team - do not file again; tell the guest it is in hand and answer their question. If they say it is taking too long, call file_request once more with priority urgent to chase it" };
  const chasing = !!prior;

  if (dept === "housekeeping" && catalog.configured.housekeeping) {
    const text = plain(detail);
    const asks = catalog.items.filter((i) => i.dept === "housekeeping" && text.includes(plain(i.name))).map((i) => ({ text: i.name, qty: quantity ?? 1, code: i.code }));
    const { confirmed } = asks.length ? resolveAsks(asks, "housekeeping", catalog) : { confirmed: [] as Confirmed[] };
    if (confirmed.length) {
      const parts = confirmed.map((c) => (c.item.kind === "amenity" ? c.qty + " x " : "") + c.item.name + (c.item.price ? " (" + money(c.item.price) + ")" : ""));
      const short = confirmed.filter((c) => c.item.kind === "amenity" && c.item.stock > 0 && (c.wanted ?? c.qty) > c.qty);
      ctx.filed.push({ intent: "housekeeping", detail: "Housekeeping: " + parts.join(", ") + (detail.length > 60 ? " - " + detail : ""), quantity: confirmed.reduce((s, c) => s + c.qty, 0), priority, whenText: when });
      return { ok: true, team: "housekeeping", items: parts, ...(short.length ? { short_stock: short.map((c) => "only " + c.item.stock + " x " + c.item.name + " available") } : {}), promise: modeOf(ctx, "housekeeping") === "auto" ? "on its way shortly" : "the team will confirm shortly" };
    }
  }

  if (dept === "maintenance") {
    const match = catalog.configured.maintenance ? matchMaintenance(detail, catalog) : null;
    const svc = match?.item;
    const urgent = priority === "urgent" || priority === "emergency" || /emergen|same/i.test(svc?.urgency ?? "");
    const label = svc && match?.byName
      ? "Maintenance: " + svc.name + (svc.category ? " (" + svc.category + ")" : "") + " - " + detail
      : "Maintenance" + (svc?.category ? " (" + svc.category + ")" : "") + ": " + detail;
    ctx.filed.push({ intent: "maintenance", detail: (chasing ? "CHASE: " : "") + label, priority: urgent ? "urgent" : priority, whenText: when });
    return { ok: true, ...(chasing ? { chased: true, note: "the team has been chased - say so, without promising a time" } : {}), team: svc?.category ? svc.category.toLowerCase() + " team" : "maintenance team", promise: svc?.responseMins ? "with you within " + svc.responseMins + " minutes" : "with you shortly", status: "always attended - never declined" };
  }

  if (dept === "front_desk" && catalog.configured.front_desk) {
    const text = plain(detail);
    const asks = catalog.items.filter((i) => i.dept === "front_desk" && text.includes(plain(i.name))).map((i) => ({ text: i.name, qty: quantity ?? 1, code: i.code }));
    const { confirmed } = asks.length ? resolveAsks(asks, "front_desk", catalog) : { confirmed: [] as Confirmed[] };
    if (confirmed.length) {
      const parts = confirmed.map((c) => c.item.name + (c.item.price ? " (" + money(c.item.price) + ")" : ""));
      ctx.filed.push({ intent: "concierge", detail: "Front desk: " + parts.join(", ") + " - " + detail, priority, whenText: when });
      return { ok: true, team: "front desk", services: parts, promise: modeOf(ctx, "front_desk") === "auto" ? "arranged" : "the front desk will arrange it and confirm shortly" };
    }
  }

  const intent: BrainRequest["intent"] = dept === "front_desk" ? "concierge" : dept === "housekeeping" ? "housekeeping" : dept === "activities" ? "activities" : dept === "spa" ? "spa" : "concierge";
  ctx.filed.push({ intent, detail: (chasing ? "CHASE: " : "") + (dept === "front_desk" ? "Front desk: " : "") + detail, priority, quantity, whenText: when });
  const promise = priority === "human_required" || priority === "emergency" ? "a member of the team will take this up personally" : modeOf(ctx, dept === "front_desk" ? "front_desk" : dept) === "auto" ? "on its way shortly" : "the team will confirm shortly";
  return { ok: true, team: TEAM_LABEL[dept], promise };
}

/** Run one tool call from Claude; a tool never throws at the model, it explains. */
export async function runTool(name: string, input: Record<string, unknown>, ctx: AgentContext): Promise<unknown> {
  try {
    switch (name) {
      case "get_spa_slots": return await getSpaSlots(input, ctx);
      case "book_spa_slot": return await bookSpaSlot(input, ctx);
      case "place_order": return await placeOrderTool(input, ctx);
      case "request_table": return await requestTable(input, ctx);
      case "cancel_order": {
      if (ctx.dryRun) { ctx.doneAlready = ctx.doneAlready.filter((d) => d.intent !== "room_service"); return { ok: true, cancelled: true, dry_run: true, note: "dry run - nothing cancelled" }; }
      const wanted = str(input.order_id, 40);
      const r = wanted ? await cancelOrder(ctx.hotelId, wanted) : await cancelLatestOrder(ctx.hotelId, ctx.guestPhone);
      if (r.outcome === "cancelled") {
        ctx.doneAlready = ctx.doneAlready.filter((d) => !(d.intent === "room_service" && d.detail.includes(r.orderId.slice(0, 8))));
        return { ok: true, cancelled: true, order: r.items, total: r.total, note: "cancelled, stock restored and the kitchen told. If the guest still wants part of it, place a fresh order with place_order" };
      }
      if (r.outcome === "started") return { ok: false, cancelled: false, reason: "the kitchen has already started on " + r.items, note: "say so honestly, and file_request to concierge with priority human_required so a person sorts it out" };
      return { ok: false, cancelled: false, reason: "no open order from this guest in the last 90 minutes", note: "tell the guest there is nothing open to cancel" };
    }
    case "file_request": return await fileRequest(input, ctx);
      default: return { ok: false, error: "unknown tool " + name };
    }
  } catch (err) {
    log.error("agent: tool failed", { name, detail: err instanceof Error ? err.message : String(err) });
    return { ok: false, error: "the system could not complete that just now - tell the guest the team will follow up, and call file_request so someone does" };
  }
}

export type { CatalogDept };
