import { prisma } from "../db";

/** The hotel's own timezone, whatever the column happens to be called. Null means fall back to server time. */
export async function hotelTimezone(hotelId: string): Promise<string | null> {
  try {
    const rows = await prisma.$queryRawUnsafe<any[]>(`select * from "Hotel" where "hotelId"=$1`, hotelId);
    const h: any = rows[0] ?? {};
    const tz = h.timezone ?? h.timeZone ?? h.time_zone ?? h.tz ?? null;
    return typeof tz === "string" && tz.trim() ? tz.trim() : null;
  } catch { return null; }
}

/** Minutes this zone is ahead of UTC at that instant (handles daylight saving, since it asks the calendar). */
function offsetMinutes(at: Date, tz: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, hour12: false, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(at);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour") % 24, get("minute"), get("second"));
  return Math.round((asUtc - at.getTime()) / 60000);
}

/** The instant when the hotel's own clock reads hh:mm, on the day `dayOffset` from `ref`. */
export function zonedAt(ref: Date, tz: string | null, hour: number, minute: number, dayOffset = 0): Date {
  const shifted = new Date(ref.getTime() + dayOffset * 86400000);
  if (!tz) { const d = new Date(shifted); d.setHours(hour, minute, 0, 0); return d; }
  const ymd = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(shifted);
  const [y, m, d] = ymd.split("-").map(Number);
  const wall = Date.UTC(y, m - 1, d, hour, minute, 0);
  let guess = wall;
  for (let i = 0; i < 2; i++) guess = wall - offsetMinutes(new Date(guess), tz) * 60000;
  return new Date(guess);
}

/** 7 pm the evening before checkout, by the hotel's clock - not the server's. */
export async function eveningBefore(hotelId: string, checkout: Date): Promise<Date> {
  return zonedAt(checkout, await hotelTimezone(hotelId), 19, 0, -1);
}

/** A date and time written the way the hotel would say it. */
export function formatLocal(at: Date, tz: string | null): string {
  return at.toLocaleString("en-GB", {
    weekday: "long", day: "numeric", month: "short", hour: "numeric", minute: "2-digit", hour12: true,
    timeZone: tz ?? undefined,
  });
}
