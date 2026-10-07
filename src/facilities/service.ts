import { prisma } from "../db";

/**
 * Facilities with a live status (knowledge base Form 2): one row per pool, gym, spa, restaurant, parking.
 * Open / Closed until a date / Limited hours, opening times with a weekend override, location, price.
 * The brain reads the rendered block on every message, so a closure takes effect from the next reply.
 */
export type FacilityStatus = "open" | "closed" | "limited";
export type Facility = {
  id: string; name: string; status: FacilityStatus; closedUntil: string | null; closureNote: string | null;
  openTime: string | null; closeTime: string | null; weekendOpenTime: string | null; weekendCloseTime: string | null;
  location: string | null; price: string | null; notes: string | null; active: boolean; sortOrder: number; updatedAt: string; updatedBy: string | null;
};
export type FacilityInput = Partial<Omit<Facility, "id" | "updatedAt" | "updatedBy">> & { name?: string };

const STATUSES: FacilityStatus[] = ["open", "closed", "limited"];
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

function norm(r: any): Facility {
  const d = (v: unknown) => (v ? String(v).slice(0, 10) : null);
  return { id: String(r.id), name: String(r.name), status: (STATUSES.includes(r.status) ? r.status : "open") as FacilityStatus, closedUntil: d(r.closed_until), closureNote: r.closure_note ?? null, openTime: r.open_time ?? null, closeTime: r.close_time ?? null, weekendOpenTime: r.weekend_open_time ?? null, weekendCloseTime: r.weekend_close_time ?? null, location: r.location ?? null, price: r.price ?? null, notes: r.notes ?? null, active: r.active !== false, sortOrder: Number(r.sort_order ?? 0), updatedAt: r.updated_at ? new Date(r.updated_at).toISOString() : "", updatedBy: r.updated_by ?? null };
}

/** Bad input is refused with a reason the GM can act on. */
export function checkFacility(f: FacilityInput, requireName: boolean): string | null {
  if (requireName && !(f.name ?? "").trim()) return "name required";
  if (f.status !== undefined && !STATUSES.includes(f.status as FacilityStatus)) return "status must be open, closed or limited";
  for (const k of ["openTime", "closeTime", "weekendOpenTime", "weekendCloseTime"] as const) { const v = f[k]; if (v && !TIME.test(String(v))) return k + " must be HH:MM (24-hour)"; }
  if (f.closedUntil && !DATE.test(String(f.closedUntil))) return "closedUntil must be YYYY-MM-DD";
  return null;
}

export async function listFacilities(hotelId: string): Promise<Facility[]> {
  const rows = await prisma.$queryRawUnsafe<any[]>("select * from facilities where hotel_id = $1 order by sort_order, name", hotelId);
  return rows.map(norm);
}

export async function addFacility(hotelId: string, f: FacilityInput, by?: string): Promise<Facility> {
  const rows = await prisma.$queryRawUnsafe<any[]>(
    "insert into facilities (hotel_id, name, status, closed_until, closure_note, open_time, close_time, weekend_open_time, weekend_close_time, location, price, notes, active, sort_order, updated_by) values ($1,$2,$3,$4::date,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) returning *",
    hotelId, String(f.name).trim(), f.status ?? "open", f.closedUntil || null, f.closureNote || null, f.openTime || null, f.closeTime || null, f.weekendOpenTime || null, f.weekendCloseTime || null, f.location || null, f.price || null, f.notes || null, f.active !== false, Number(f.sortOrder ?? 0), by || null);
  return norm(rows[0]);
}

export async function updateFacility(hotelId: string, id: string, patch: FacilityInput, by?: string): Promise<Facility | null> {
  const cur = await prisma.$queryRawUnsafe<any[]>("select * from facilities where hotel_id = $1 and id = $2::uuid", hotelId, id);
  if (!cur[0]) return null;
  const f = { ...norm(cur[0]), ...patch };
  const rows = await prisma.$queryRawUnsafe<any[]>(
    "update facilities set name=$3, status=$4, closed_until=$5::date, closure_note=$6, open_time=$7, close_time=$8, weekend_open_time=$9, weekend_close_time=$10, location=$11, price=$12, notes=$13, active=$14, sort_order=$15, updated_at=now(), updated_by=$16 where hotel_id=$1 and id=$2::uuid returning *",
    hotelId, id, String(f.name).trim(), f.status ?? "open", f.closedUntil || null, f.closureNote || null, f.openTime || null, f.closeTime || null, f.weekendOpenTime || null, f.weekendCloseTime || null, f.location || null, f.price || null, f.notes || null, f.active !== false, Number(f.sortOrder ?? 0), by || null);
  return rows[0] ? norm(rows[0]) : null;
}

export async function deleteFacility(hotelId: string, id: string): Promise<boolean> {
  const n = await prisma.$executeRawUnsafe("delete from facilities where hotel_id = $1 and id = $2::uuid", hotelId, id);
  return Number(n) > 0;
}

/** A closure with a date in the past has ended; everything else is what the GM set. */
export function effectiveStatus(f: Facility, today: string): FacilityStatus {
  if (f.status === "closed" && f.closedUntil && f.closedUntil < today) return "open";
  return f.status;
}

const nice = (ymd: string): string => { const d = new Date(ymd + "T00:00:00Z"); return isNaN(d.getTime()) ? ymd : d.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }); };

/** The block the brain reads. Empty when the hotel has no facilities recorded. */
export function renderFacilities(list: Facility[], today: string, weekend: boolean): string {
  const live = list.filter((f) => f.active);
  if (!live.length) return "";
  const lines = live.map((f) => {
    const st = effectiveStatus(f, today);
    const hours = weekend && f.weekendOpenTime && f.weekendCloseTime ? f.weekendOpenTime + "-" + f.weekendCloseTime + " today (weekend hours)" : f.openTime && f.closeTime ? f.openTime + "-" + f.closeTime + (f.weekendOpenTime && f.weekendCloseTime ? " (weekends " + f.weekendOpenTime + "-" + f.weekendCloseTime + ")" : "") : "";
    let head = "";
    if (st === "closed") head = "CLOSED" + (f.closedUntil ? " until " + nice(f.closedUntil) : " today") + (f.closureNote ? " (" + f.closureNote + ")" : "") + " - do not suggest it; a request for it is refused with this reason";
    else if (st === "limited") head = "LIMITED today" + (hours ? ": " + hours : "") + (f.closureNote ? " (" + f.closureNote + ")" : "");
    else head = hours ? "open " + hours : "open";
    const extra = [f.location, f.price, f.notes].filter(Boolean).join(". ");
    return "- " + f.name + ": " + head + (extra ? ". " + extra : "") + ".";
  });
  return "FACILITIES (live status from the front office, " + nice(today) + " - this overrides anything else you know about these facilities; never suggest or book a closed one):\n" + lines.join("\n");
}

/** Today's date and weekend flag in the hotel's own time zone. */
export function hotelToday(timezone: string | null | undefined, now = new Date()): { today: string; weekend: boolean } {
  const tz = timezone || "Asia/Kolkata";
  try {
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
    const day = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short" }).format(now);
    return { today, weekend: day === "Sat" || day === "Sun" };
  } catch { const today = now.toISOString().slice(0, 10); const d = now.getUTCDay(); return { today, weekend: d === 0 || d === 6 }; }
}

export async function facilitiesForPrompt(hotelId: string): Promise<string> {
  try {
    const [list, hotel] = await Promise.all([listFacilities(hotelId), prisma.hotel.findUnique({ where: { hotelId }, select: { timezone: true } })]);
    const { today, weekend } = hotelToday(hotel?.timezone ?? null);
    return renderFacilities(list, today, weekend);
  } catch { return ""; }
}
