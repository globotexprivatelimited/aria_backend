import { prisma } from "../db";
import { log } from "../lib/logger";

/**
 * Settings that used to be constants in code, now per hotel and editable in the console: quiet hours (nothing
 * unprompted at night), the evening nudge window, how often an upsell may be offered, and each department's
 * working hours. Read through a one-minute cache, so a change takes effect without a deploy.
 */
export type HotelHours = { quietFrom: number; quietTo: number; nudgeFrom: number; nudgeTo: number; offerGapHours: number; offersPerDay: number; updatedAt: string | null; updatedBy: string | null };
export const DEFAULT_HOURS: HotelHours = { quietFrom: 21 * 60 + 30, quietTo: 8 * 60, nudgeFrom: 17 * 60, nudgeTo: 21 * 60, offerGapHours: 3, offersPerDay: 2, updatedAt: null, updatedBy: null };
export type HoursInput = { quietFrom?: string; quietTo?: string; nudgeFrom?: string; nudgeTo?: string; offerGapHours?: number | string; offersPerDay?: number | string };

const pad = (n: number): string => String(n).padStart(2, "0");
const wrap = (m: number): number => ((m % 1440) + 1440) % 1440;
/** Minutes since midnight as HH:MM. */
export const hhmm = (m: number): string => pad(Math.floor(wrap(m) / 60)) + ":" + pad(wrap(m) % 60);
/** "HH:MM" (24-hour) as minutes since midnight; null when it is not a time. */
export function minutesOf(v: unknown): number | null {
  const m = /^\s*([01]?\d|2[0-3]):([0-5]\d)\s*$/.exec(String(v ?? ""));
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}
/** Is a moment inside [from, to)? The window may cross midnight; an empty window (from == to) holds nothing. */
export function inWindow(minutes: number, from: number, to: number): boolean {
  if (from === to) return false;
  return from < to ? minutes >= from && minutes < to : minutes >= from || minutes < to;
}
/** A message held by quiet hours waits until quiet hours end - tomorrow morning when they started this evening. */
export function quietEndsTomorrow(minutes: number, h: HotelHours): boolean {
  return h.quietFrom > h.quietTo && minutes >= h.quietFrom;
}

const cache = new Map<string, { at: number; hours: HotelHours }>();
const TTL_MS = 60 * 1000;
function norm(r: any): HotelHours {
  return { quietFrom: Number(r.quiet_from), quietTo: Number(r.quiet_to), nudgeFrom: Number(r.nudge_from), nudgeTo: Number(r.nudge_to), offerGapHours: Number(r.offer_gap_hours), offersPerDay: Number(r.offers_per_day), updatedAt: r.updated_at ? new Date(r.updated_at).toISOString() : null, updatedBy: r.updated_by ?? null };
}

export async function hotelHours(hotelId: string): Promise<HotelHours> {
  const hit = cache.get(hotelId);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.hours;
  try {
    const rows = await prisma.$queryRawUnsafe<any[]>("select * from hotel_settings where hotel_id = $1", hotelId);
    const hours = rows[0] ? norm(rows[0]) : { ...DEFAULT_HOURS };
    cache.set(hotelId, { at: Date.now(), hours });
    return hours;
  } catch (e) {
    log.warn("settings: could not load, using the defaults", { hotelId, detail: e instanceof Error ? e.message : String(e) });
    return { ...DEFAULT_HOURS };
  }
}
export function forgetHours(hotelId?: string): void { if (hotelId) cache.delete(hotelId); else cache.clear(); }

/** Bad input is refused with a reason the GM can act on. */
export function checkHours(cur: HotelHours, input: HoursInput): { ok: true; hours: HotelHours } | { ok: false; error: string } {
  const next: HotelHours = { ...cur };
  for (const k of ["quietFrom", "quietTo", "nudgeFrom", "nudgeTo"] as const) {
    if (input[k] === undefined) continue;
    const m = minutesOf(input[k]);
    if (m === null) return { ok: false, error: k + " must be HH:MM (24-hour)" };
    next[k] = m;
  }
  if (input.offerGapHours !== undefined) { const n = Number(input.offerGapHours); if (!Number.isFinite(n) || n < 0 || n > 48) return { ok: false, error: "offerGapHours must be between 0 and 48" }; next.offerGapHours = Math.round(n); }
  if (input.offersPerDay !== undefined) { const n = Number(input.offersPerDay); if (!Number.isFinite(n) || n < 0 || n > 10) return { ok: false, error: "offersPerDay must be between 0 and 10" }; next.offersPerDay = Math.round(n); }
  if (next.nudgeFrom === next.nudgeTo) return { ok: false, error: "the evening nudge window is empty" };
  if (inWindow(next.nudgeFrom, next.quietFrom, next.quietTo) && inWindow(wrap(next.nudgeTo - 1), next.quietFrom, next.quietTo)) return { ok: false, error: "the nudge window sits inside quiet hours - no nudge could ever be sent" };
  return { ok: true, hours: next };
}

export async function setHotelHours(hotelId: string, input: HoursInput, by?: string): Promise<{ ok: true; data: HotelHours } | { ok: false; error: string }> {
  const checked = checkHours(await hotelHours(hotelId), input);
  if (!checked.ok) return checked;
  const h = checked.hours;
  const rows = await prisma.$queryRawUnsafe<any[]>(
    "insert into hotel_settings (hotel_id, quiet_from, quiet_to, nudge_from, nudge_to, offer_gap_hours, offers_per_day, updated_by) values ($1,$2,$3,$4,$5,$6,$7,$8) on conflict (hotel_id) do update set quiet_from = excluded.quiet_from, quiet_to = excluded.quiet_to, nudge_from = excluded.nudge_from, nudge_to = excluded.nudge_to, offer_gap_hours = excluded.offer_gap_hours, offers_per_day = excluded.offers_per_day, updated_at = now(), updated_by = excluded.updated_by returning *",
    hotelId, h.quietFrom, h.quietTo, h.nudgeFrom, h.nudgeTo, h.offerGapHours, h.offersPerDay, by || null);
  const saved = norm(rows[0]);
  cache.set(hotelId, { at: Date.now(), hours: saved });
  log.info("settings: hours changed", { hotelId, by: by || "?", quiet: hhmm(saved.quietFrom) + "-" + hhmm(saved.quietTo), nudge: hhmm(saved.nudgeFrom) + "-" + hhmm(saved.nudgeTo), offers: saved.offersPerDay + "/day, " + saved.offerGapHours + "h apart" });
  return { ok: true, data: saved };
}

/** What the console shows: the same settings with times as HH:MM. */
export function hoursForApi(h: HotelHours): { quietFrom: string; quietTo: string; nudgeFrom: string; nudgeTo: string; offerGapHours: number; offersPerDay: number; updatedAt: string | null; updatedBy: string | null } {
  return { quietFrom: hhmm(h.quietFrom), quietTo: hhmm(h.quietTo), nudgeFrom: hhmm(h.nudgeFrom), nudgeTo: hhmm(h.nudgeTo), offerGapHours: h.offerGapHours, offersPerDay: h.offersPerDay, updatedAt: h.updatedAt, updatedBy: h.updatedBy };
}

export async function offerLimits(hotelId: string): Promise<{ gapHours: number; perDay: number }> {
  const h = await hotelHours(hotelId);
  return { gapHours: h.offerGapHours, perDay: h.offersPerDay };
}

/* ---------------------------------------------------------------- department hours ---- */

export const DEPARTMENTS: { dept: string; label: string }[] = [
  { dept: "fb", label: "Room service (kitchen)" }, { dept: "dining", label: "Restaurant" }, { dept: "spa", label: "Spa" },
  { dept: "housekeeping", label: "Housekeeping" }, { dept: "concierge", label: "Concierge" }, { dept: "maintenance", label: "Maintenance" }, { dept: "front_desk", label: "Front desk" },
];
export const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
export type DeptHours = { id: string; dept: string; label: string; openTime: string | null; closeTime: string | null; weekendOpenTime: string | null; weekendCloseTime: string | null; closedDays: string[]; outOfHours: string | null; active: boolean; updatedAt: string; updatedBy: string | null };
export type DeptHoursInput = { dept: string; openTime?: string | null; closeTime?: string | null; weekendOpenTime?: string | null; weekendCloseTime?: string | null; closedDays?: string[] | string | null; outOfHours?: string | null; active?: boolean };

export const deptLabel = (dept: string): string => DEPARTMENTS.find((d) => d.dept === dept)?.label ?? dept;
const dayList = (v: unknown): string[] => (Array.isArray(v) ? v : String(v ?? "").split(",")).map((s) => String(s).trim().slice(0, 3)).map((s) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase()).filter((s) => DAYS.includes(s));
const time = (v: unknown): string | null => { const m = minutesOf(v); return m === null ? null : hhmm(m); };
function normDept(r: any): DeptHours {
  return { id: String(r.id), dept: String(r.dept), label: deptLabel(String(r.dept)), openTime: r.open_time ?? null, closeTime: r.close_time ?? null, weekendOpenTime: r.weekend_open_time ?? null, weekendCloseTime: r.weekend_close_time ?? null, closedDays: dayList(r.closed_days), outOfHours: r.out_of_hours ?? null, active: r.active !== false, updatedAt: r.updated_at ? new Date(r.updated_at).toISOString() : "", updatedBy: r.updated_by ?? null };
}

export function checkDeptHours(d: DeptHoursInput): string | null {
  if (!d.dept || !DEPARTMENTS.some((x) => x.dept === d.dept)) return "dept must be one of " + DEPARTMENTS.map((x) => x.dept).join(", ");
  for (const k of ["openTime", "closeTime", "weekendOpenTime", "weekendCloseTime"] as const) { const v = d[k]; if (v && minutesOf(v) === null) return k + " must be HH:MM (24-hour)"; }
  if (!!d.openTime !== !!d.closeTime) return "give both an opening and a closing time, or neither for 24 hours";
  if (!!d.weekendOpenTime !== !!d.weekendCloseTime) return "give both weekend times, or neither";
  return null;
}

export async function listDeptHours(hotelId: string): Promise<DeptHours[]> {
  const rows = await prisma.$queryRawUnsafe<any[]>("select * from dept_hours where hotel_id = $1", hotelId);
  const order = new Map(DEPARTMENTS.map((d, i) => [d.dept, i]));
  return rows.map(normDept).sort((a, b) => (order.get(a.dept) ?? 99) - (order.get(b.dept) ?? 99));
}

export async function setDeptHours(hotelId: string, d: DeptHoursInput, by?: string): Promise<DeptHours> {
  const rows = await prisma.$queryRawUnsafe<any[]>(
    "insert into dept_hours (hotel_id, dept, open_time, close_time, weekend_open_time, weekend_close_time, closed_days, out_of_hours, active, updated_by) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) on conflict (hotel_id, dept) do update set open_time = excluded.open_time, close_time = excluded.close_time, weekend_open_time = excluded.weekend_open_time, weekend_close_time = excluded.weekend_close_time, closed_days = excluded.closed_days, out_of_hours = excluded.out_of_hours, active = excluded.active, updated_at = now(), updated_by = excluded.updated_by returning *",
    hotelId, d.dept, time(d.openTime), time(d.closeTime), time(d.weekendOpenTime), time(d.weekendCloseTime), dayList(d.closedDays).join(","), (d.outOfHours ?? "").toString().trim().slice(0, 300) || null, d.active !== false, by || null);
  log.info("settings: department hours changed", { hotelId, dept: d.dept, by: by || "?" });
  return normDept(rows[0]);
}

export async function deleteDeptHours(hotelId: string, dept: string): Promise<boolean> {
  const n = await prisma.$executeRawUnsafe("delete from dept_hours where hotel_id = $1 and dept = $2", hotelId, dept);
  return Number(n) > 0;
}

/** Open at this moment? null when the department keeps no hours (it is treated as always open). */
export function deptOpenNow(d: DeptHours, minutes: number, weekday: string): boolean | null {
  if (d.closedDays.includes(weekday)) return false;
  const weekend = weekday === "Sat" || weekday === "Sun";
  const useWeekend = weekend && !!d.weekendOpenTime && !!d.weekendCloseTime;
  const a = minutesOf(useWeekend ? d.weekendOpenTime : d.openTime), b = minutesOf(useWeekend ? d.weekendCloseTime : d.closeTime);
  if (a === null || b === null) return null;
  return inWindow(minutes, a, b);
}

/** The block the brain reads. Empty when no department keeps hours. */
export function renderDeptHours(list: DeptHours[], minutes: number, weekday: string): string {
  const live = list.filter((d) => d.active);
  if (!live.length) return "";
  const lines = live.map((d) => {
    const open = deptOpenNow(d, minutes, weekday);
    const hours = d.openTime && d.closeTime ? d.openTime + "-" + d.closeTime + (d.weekendOpenTime && d.weekendCloseTime ? " (weekends " + d.weekendOpenTime + "-" + d.weekendCloseTime + ")" : "") : "24 hours";
    const closed = d.closedDays.length ? ", closed " + d.closedDays.join("/") : "";
    const now = open === null ? "" : open ? " - OPEN now" : " - CLOSED now" + (d.outOfHours ? " (" + d.outOfHours + ")" : "");
    return "- " + d.label + ": " + hours + closed + now;
  });
  return "DEPARTMENT HOURS (hotel time, now " + hhmm(minutes) + " " + weekday + "). For a department that is CLOSED now: do not place an order or booking with it; say when it opens, offer to note the request for then, and offer what is open instead. The front desk can be reached at any hour.\n" + lines.join("\n");
}

/** The hotel's clock: minutes since midnight and the weekday, in its own time zone. */
export function hotelNow(timezone: string | null | undefined, now: Date = new Date()): { minutes: number; weekday: string } {
  const tz = timezone || "Asia/Kolkata";
  try {
    const t = new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(now);
    const weekday = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short" }).format(now);
    return { minutes: minutesOf(t) ?? now.getUTCHours() * 60 + now.getUTCMinutes(), weekday };
  } catch { return { minutes: now.getUTCHours() * 60 + now.getUTCMinutes(), weekday: DAYS[(now.getUTCDay() + 6) % 7] }; }
}

export async function deptHoursForPrompt(hotelId: string): Promise<string> {
  try {
    const [list, hotel] = await Promise.all([listDeptHours(hotelId), prisma.hotel.findUnique({ where: { hotelId }, select: { timezone: true } })]);
    const { minutes, weekday } = hotelNow(hotel?.timezone ?? null);
    return renderDeptHours(list, minutes, weekday);
  } catch { return ""; }
}
