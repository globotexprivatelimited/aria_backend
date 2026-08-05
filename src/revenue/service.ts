import { prisma } from "../db";

type Result<T> = { ok: true; data: T } | { ok: false; error: string };
function n(v: any): number { return v == null ? 0 : Number(v); }

// combined revenue summary across dining orders + dining bookings + activity bookings
export async function revenueSummary(hotelId: string): Promise<Result<any>> {
  if (!hotelId) return { ok: false, error: "hotelId required" };
  try {
    const q = async (sql: string) => { const r = await prisma.$queryRawUnsafe<any[]>(sql, hotelId); return r[0] ?? {}; };
    // orders (dining) - total column; count only paid/served-ish (all non-cancelled)
    const orders = await q(`select coalesce(sum(total),0) rev, count(*) cnt,
      coalesce(sum(case when created_at::date = current_date then total else 0 end),0) d_today,
      coalesce(sum(case when created_at >= date_trunc('week', now()) then total else 0 end),0) d_week,
      coalesce(sum(case when created_at >= date_trunc('month', now()) then total else 0 end),0) d_month
      from orders where hotel_id = $1 and status::text <> 'cancelled'`);
    const dining = await q(`select coalesce(sum("revenueGenerated"),0) rev, count(*) cnt,
      coalesce(sum(case when "createdAt"::date = current_date then "revenueGenerated" else 0 end),0) d_today,
      coalesce(sum(case when "createdAt" >= date_trunc('week', now()) then "revenueGenerated" else 0 end),0) d_week,
      coalesce(sum(case when "createdAt" >= date_trunc('month', now()) then "revenueGenerated" else 0 end),0) d_month
      from "DiningBooking" where "hotelId" = $1 and status <> 'cancelled'`);
    const activity = await q(`select coalesce(sum("totalRevenue"),0) rev, count(*) cnt,
      coalesce(sum(case when "createdAt"::date = current_date then "totalRevenue" else 0 end),0) d_today,
      coalesce(sum(case when "createdAt" >= date_trunc('week', now()) then "totalRevenue" else 0 end),0) d_week,
      coalesce(sum(case when "createdAt" >= date_trunc('month', now()) then "totalRevenue" else 0 end),0) d_month
      from "ActivityBooking" where "hotelId" = $1 and status <> 'cancelled'`);

    const total = n(orders.rev) + n(dining.rev) + n(activity.rev);
    const totalCnt = n(orders.cnt) + n(dining.cnt) + n(activity.cnt);
    return { ok: true, data: {
      total,
      today: n(orders.d_today) + n(dining.d_today) + n(activity.d_today),
      week: n(orders.d_week) + n(dining.d_week) + n(activity.d_week),
      month: n(orders.d_month) + n(dining.d_month) + n(activity.d_month),
      transactions: totalCnt,
      avgOrder: totalCnt ? Math.round(total / totalCnt) : 0,
    } };
  } catch (e) { return { ok: false, error: e instanceof Error ? e.message : "revenue summary failed" }; }
}

// revenue split by channel
export async function revenueByChannel(hotelId: string): Promise<Result<any[]>> {
  if (!hotelId) return { ok: false, error: "hotelId required" };
  try {
    const one = async (sql: string) => { const r = await prisma.$queryRawUnsafe<any[]>(sql, hotelId); return n(r[0]?.rev); };
    const dining = await one(`select coalesce(sum(total),0) rev from orders where hotel_id=$1 and status::text<>'cancelled'`);
    const diningBk = await one(`select coalesce(sum("revenueGenerated"),0) rev from "DiningBooking" where "hotelId"=$1 and status<>'cancelled'`);
    const activity = await one(`select coalesce(sum("totalRevenue"),0) rev from "ActivityBooking" where "hotelId"=$1 and status<>'cancelled'`);
    return { ok: true, data: [
      { channel: "In-Room Dining", value: dining, color: "#0F5F4C" },
      { channel: "Dining Reservations", value: diningBk, color: "#3A6EA5" },
      { channel: "Spa & Activities", value: activity, color: "#8E5AA8" },
    ].filter((x) => x.value > 0) };
  } catch (e) { return { ok: false, error: e instanceof Error ? e.message : "by-channel failed" }; }
}

// daily revenue time-series (last N days), combined
export async function revenueTimeseries(hotelId: string, days = 30): Promise<Result<any[]>> {
  if (!hotelId) return { ok: false, error: "hotelId required" };
  try {
    const rows = await prisma.$queryRawUnsafe<any[]>(`
      with series as (select generate_series(current_date - ($2::int - 1), current_date, interval '1 day')::date as dt)
      select series.dt as dt,
        coalesce((select sum(total) from orders o where o.hotel_id=$1 and o.created_at::date=series.dt and o.status::text<>'cancelled'),0)
        + coalesce((select sum("revenueGenerated") from "DiningBooking" b where b."hotelId"=$1 and b."createdAt"::date=series.dt and b.status<>'cancelled'),0)
        + coalesce((select sum("totalRevenue") from "ActivityBooking" a where a."hotelId"=$1 and a."createdAt"::date=series.dt and a.status<>'cancelled'),0) as rev
      from series order by series.dt`, hotelId, days);
    return { ok: true, data: rows.map((r) => ({ date: r.dt, label: new Date(r.dt).toLocaleDateString(undefined, { month: "short", day: "numeric" }), revenue: n(r.rev) })) };
  } catch (e) { return { ok: false, error: e instanceof Error ? e.message : "timeseries failed" }; }
}

// top-earning menu items (from order_items)
export async function topItems(hotelId: string): Promise<Result<any[]>> {
  if (!hotelId) return { ok: false, error: "hotelId required" };
  try {
    const rows = await prisma.$queryRawUnsafe<any[]>(`
      select oi.name, sum(oi.qty) qty, sum(oi.qty * oi.unit_price) rev
      from order_items oi join orders o on o.id = oi.order_id
      where o.hotel_id = $1 and o.status::text <> 'cancelled'
      group by oi.name order by rev desc limit 8`, hotelId);
    return { ok: true, data: rows.map((r) => ({ name: r.name, qty: n(r.qty), revenue: n(r.rev) })) };
  } catch (e) { return { ok: false, error: e instanceof Error ? e.message : "top-items failed" }; }
}

// revenue by department (dining/spa/etc from orders.dept + bookings)
export async function revenueByDept(hotelId: string): Promise<Result<any[]>> {
  if (!hotelId) return { ok: false, error: "hotelId required" };
  try {
    const rows = await prisma.$queryRawUnsafe<any[]>(
      `select dept, coalesce(sum(total),0) rev, count(*) cnt from orders where hotel_id=$1 and status::text<>'cancelled' group by dept order by rev desc`, hotelId);
    return { ok: true, data: rows.map((r) => ({ dept: r.dept, revenue: n(r.rev), orders: n(r.cnt) })) };
  } catch (e) { return { ok: false, error: e instanceof Error ? e.message : "by-dept failed" }; }
}

// hourly revenue (24h) - when money comes in
export async function revenueByHour(hotelId: string): Promise<Result<any[]>> {
  if (!hotelId) return { ok: false, error: "hotelId required" };
  try {
    const rows = await prisma.$queryRawUnsafe<any[]>(
      `select extract(hour from created_at)::int hr, coalesce(sum(total),0) rev from orders where hotel_id=$1 and status::text<>'cancelled' group by hr order by hr`, hotelId);
    const hours = Array.from({ length: 24 }, (_, h) => ({ hour: h, label: (h % 12 === 0 ? 12 : h % 12) + (h < 12 ? "a" : "p"), revenue: 0 }));
    for (const r of rows) { const h = Number(r.hr); if (h >= 0 && h < 24) hours[h].revenue = n(r.rev); }
    return { ok: true, data: hours };
  } catch (e) { return { ok: false, error: e instanceof Error ? e.message : "by-hour failed" }; }
}

// top revenue-generating rooms
export async function revenueByRoom(hotelId: string): Promise<Result<any[]>> {
  if (!hotelId) return { ok: false, error: "hotelId required" };
  try {
    const rows = await prisma.$queryRawUnsafe<any[]>(
      `select room, coalesce(sum(total),0) rev, count(*) cnt from orders where hotel_id=$1 and room is not null and status::text<>'cancelled' group by room order by rev desc limit 8`, hotelId);
    return { ok: true, data: rows.map((r) => ({ room: r.room, revenue: n(r.rev), orders: n(r.cnt) })) };
  } catch (e) { return { ok: false, error: e instanceof Error ? e.message : "by-room failed" }; }
}