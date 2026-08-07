import { prisma } from "../db";
type Result<T> = { ok: true; data: T } | { ok: false; error: string };

export type HotelSummary = {
  hotelId: string; name: string; city: string | null; onboarded: boolean; isActive: boolean;
  emailVerified: boolean; revenueSharePercent: number; contactEmail: string | null; whatsappNumber: string | null;
  rooms: { total: number; occupied: number; available: number; cleaning: number; occupancyPct: number };
  guestsInHouse: number;
  staff: { total: number; onDuty: number; names: string[] };
  requests: { open: number; inProgress: number; resolvedToday: number; urgent: number };
  revenue: { today: number; week: number; total: number };
  missed: { count: number; estimatedLoss: number };
  lastActivity: string | null;
};

/** Everything a founder needs about every hotel, in one pass. */
export async function getPortfolio(): Promise<Result<{ hotels: HotelSummary[]; totals: Record<string, number> }>> {
  try {
    const hotels = await prisma.$queryRawUnsafe<any[]>(
      `select "hotelId", name, city, onboarded, "isActive", coalesce(email_verified,false) as email_verified,
              "revenueSharePercent", contact_email, "whatsappNumber"
         from "Hotel" order by "hotelId"`);

    const rooms = await prisma.$queryRawUnsafe<any[]>(
      `select hotel_id, status, count(*)::int n, coalesce(sum(party_size),0)::int guests
         from rooms group by hotel_id, status`);

    const staff = await prisma.$queryRawUnsafe<any[]>(
      `select hotel_id, full_name, role,
              (last_seen is not null and last_seen > now() - interval '120 seconds') as on_duty
         from staff_users where is_active is not false and role <> 'founder'`);

    const reqs = await prisma.$queryRawUnsafe<any[]>(
      `select "hotelId", status::text status, priority::text priority,
              ("resolvedAt" is not null and "resolvedAt" >= date_trunc('day', now())) as resolved_today,
              coalesce("revenueGenerated",0)::float revenue,
              "createdAt" >= date_trunc('day', now()) as is_today,
              "createdAt" >= now() - interval '7 days' as is_week,
              "createdAt"
         from "Request" where "createdAt" > now() - interval '90 days'`);

    let missed: any[] = [];
    try {
      missed = await prisma.$queryRawUnsafe<any[]>(
        `select hotel_id, count(*)::int n, coalesce(sum(estimated_value),0)::float loss
           from missed_demand where resolved_by_hotel = false group by hotel_id`);
    } catch { /* table may not exist on older databases */ }

    const out: HotelSummary[] = hotels.map((h) => {
      const id = String(h.hotelId);
      const rRows = rooms.filter((r) => String(r.hotel_id) === id);
      const pick = (s: string) => rRows.find((r) => r.status === s)?.n ?? 0;
      const total = rRows.reduce((s, r) => s + r.n, 0);
      const occupied = pick("occupied");

      const sRows = staff.filter((s) => String(s.hotel_id) === id);
      const onDutyRows = sRows.filter((s) => s.on_duty);

      const qRows = reqs.filter((r) => String(r.hotelId) === id);
      const m = missed.find((x) => String(x.hotel_id) === id);
      const latest = qRows.reduce<string | null>((acc, r) => {
        const t = new Date(r.createdAt).toISOString();
        return !acc || t > acc ? t : acc;
      }, null);

      return {
        hotelId: id, name: h.name, city: h.city ?? null,
        onboarded: !!h.onboarded, isActive: !!h.isActive, emailVerified: !!h.email_verified,
        revenueSharePercent: Number(h.revenueSharePercent ?? 0),
        contactEmail: h.contact_email ?? null, whatsappNumber: h.whatsappNumber ?? null,
        rooms: {
          total, occupied, available: pick("available"), cleaning: pick("cleaning"),
          occupancyPct: total ? Math.round((occupied / total) * 100) : 0,
        },
        guestsInHouse: rRows.filter((r) => r.status === "occupied").reduce((s, r) => s + (r.guests ?? 0), 0),
        staff: { total: sRows.length, onDuty: onDutyRows.length, names: onDutyRows.map((s) => s.full_name) },
        requests: {
          open: qRows.filter((r) => r.status === "received").length,
          inProgress: qRows.filter((r) => r.status === "in_progress").length,
          resolvedToday: qRows.filter((r) => r.resolved_today).length,
          urgent: qRows.filter((r) => r.priority === "urgent" && r.status !== "resolved").length,
        },
        revenue: {
          today: qRows.filter((r) => r.is_today).reduce((s, r) => s + r.revenue, 0),
          week: qRows.filter((r) => r.is_week).reduce((s, r) => s + r.revenue, 0),
          total: qRows.reduce((s, r) => s + r.revenue, 0),
        },
        missed: { count: m?.n ?? 0, estimatedLoss: m?.loss ?? 0 },
        lastActivity: latest,
      };
    });

    const totals = {
      hotels: out.length,
      rooms: out.reduce((s, h) => s + h.rooms.total, 0),
      occupied: out.reduce((s, h) => s + h.rooms.occupied, 0),
      guests: out.reduce((s, h) => s + h.guestsInHouse, 0),
      staff: out.reduce((s, h) => s + h.staff.total, 0),
      onDuty: out.reduce((s, h) => s + h.staff.onDuty, 0),
      openRequests: out.reduce((s, h) => s + h.requests.open, 0),
      urgent: out.reduce((s, h) => s + h.requests.urgent, 0),
      revenueToday: out.reduce((s, h) => s + h.revenue.today, 0),
      revenueWeek: out.reduce((s, h) => s + h.revenue.week, 0),
      revenueTotal: out.reduce((s, h) => s + h.revenue.total, 0),
      missedLoss: out.reduce((s, h) => s + h.missed.estimatedLoss, 0),
    };

    return { ok: true, data: { hotels: out, totals } };
  } catch (e) { return { ok: false, error: e instanceof Error ? e.message : "portfolio failed" }; }
}

export type HotelDetail = {
  hotel: {
    hotelId: string; name: string; city: string | null; address: string | null;
    whatsappNumber: string | null; contactEmail: string | null; contactPhone: string | null;
    checkInTime: string | null; checkOutTime: string | null; roomTarget: number | null;
    onboarded: boolean; isActive: boolean; emailVerified: boolean; revenueSharePercent: number;
    planCode: string; pilotEndsAt: string | null; accountOwner: string | null;
    createdAt: string;
  };
  rooms: { roomNumber: string; type: string | null; floor: number | null; status: string;
           guestName: string | null; guestPhone: string | null; partySize: number | null;
           checkIn: string | null; checkOut: string | null; notes: string | null }[];
  staff: { name: string; email: string | null; role: string; phone: string | null;
           onDuty: boolean; lastSeen: string | null; departments: string[] }[];
  departments: { dept: string; mode: string; open: number; inProgress: number; resolvedToday: number; offerings: number }[];
  requests: { id: string; room: string | null; detail: string | null; department: string | null;
              status: string; priority: string; claimedBy: string | null; declined: boolean;
              createdAt: string; claimedAt: string | null; resolvedAt: string | null; revenue: number }[];
  missed: { item: string; department: string | null; times: number; loss: number }[];
  revenue: { today: number; week: number; month: number; total: number; byDept: { dept: string; amount: number }[] };
};

/** Everything about one hotel - the founder's drill-down. */
export async function getHotelDetail(hotelId: string): Promise<Result<HotelDetail>> {
  if (!hotelId) return { ok: false, error: "hotelId required" };
  try {
    const hRows = await prisma.$queryRawUnsafe<any[]>(
      `select "hotelId", name, city, address, "whatsappNumber", contact_email, contact_phone,
              check_in_time, check_out_time, room_count, onboarded, "isActive",
              coalesce(email_verified,false) email_verified, "revenueSharePercent", "createdAt",
              coalesce(plan_code,'pilot') plan_code, pilot_ends_at, account_owner
         from "Hotel" where "hotelId" = $1 limit 1`, hotelId);
    if (!hRows[0]) return { ok: false, error: "Hotel not found." };
    const h = hRows[0];

    const rooms = await prisma.$queryRawUnsafe<any[]>(
      `select room_number, room_type, floor, status, guest_name, guest_phone, party_size, check_in, check_out, notes
         from rooms where hotel_id = $1 order by floor, room_number`, hotelId);

    const staffRows = await prisma.$queryRawUnsafe<any[]>(
      `select su.id, su.full_name, su.email, su.role, su.phone, su.last_seen,
              (su.last_seen is not null and su.last_seen > now() - interval '120 seconds') on_duty,
              coalesce(array_agg(sd.dept) filter (where sd.active), '{}') depts
         from staff_users su
         left join staff_departments sd on sd.staff_user_id = su.id
        where su.hotel_id = $1 and su.is_active is not false and su.role <> 'founder'
        group by su.id order by su.role, su.full_name`, hotelId);

    const reqRows = await prisma.$queryRawUnsafe<any[]>(
      `select id, "roomNumber", "requestDetail", department::text dept, status::text status, priority::text priority,
              "claimedBy", coalesce(declined,false) declined, "createdAt", "claimedAt", "resolvedAt",
              coalesce("revenueGenerated",0)::float revenue
         from "Request" where "hotelId" = $1 and "createdAt" > now() - interval '30 days'
        order by "createdAt" desc limit 200`, hotelId);

    let modes: any[] = [];
    try { modes = await prisma.$queryRawUnsafe<any[]>(`select dept, mode from dept_config where hotel_id = $1`, hotelId); } catch {}
    let items: any[] = [];
    try { items = await prisma.$queryRawUnsafe<any[]>(`select dept, count(*)::int n from dept_items where hotel_id = $1 group by dept`, hotelId); } catch {}
    let missedRows: any[] = [];
    try {
      missedRows = await prisma.$queryRawUnsafe<any[]>(
        `select requested_item, department, count(*)::int n, coalesce(sum(estimated_value),0)::float loss
           from missed_demand where hotel_id = $1 and resolved_by_hotel = false
          group by requested_item, department order by n desc limit 20`, hotelId);
    } catch {}

    const startDay = new Date(); startDay.setHours(0, 0, 0, 0);
    const inRange = (iso: any, days: number) => new Date(iso).getTime() > Date.now() - days * 86400000;
    const deptKeys = Array.from(new Set([...reqRows.map((r) => r.dept), ...modes.map((m) => m.dept), ...items.map((i) => i.dept)].filter(Boolean)));

    return { ok: true, data: {
      hotel: {
        hotelId: String(h.hotelId), name: h.name, city: h.city ?? null, address: h.address ?? null,
        whatsappNumber: h.whatsappNumber ?? null, contactEmail: h.contact_email ?? null, contactPhone: h.contact_phone ?? null,
        checkInTime: h.check_in_time ?? null, checkOutTime: h.check_out_time ?? null,
        roomTarget: h.room_count == null ? null : Number(h.room_count),
        onboarded: !!h.onboarded, isActive: !!h.isActive, emailVerified: !!h.email_verified,
        revenueSharePercent: Number(h.revenueSharePercent ?? 0), createdAt: new Date(h.createdAt).toISOString(),
        planCode: h.plan_code ?? "pilot",
        pilotEndsAt: h.pilot_ends_at ? new Date(h.pilot_ends_at).toISOString() : null,
        accountOwner: h.account_owner ?? null,
      },
      rooms: rooms.map((r) => ({
        roomNumber: r.room_number, type: r.room_type ?? null, floor: r.floor ?? null, status: r.status,
        guestName: r.guest_name ?? null, guestPhone: r.guest_phone ?? null, partySize: r.party_size ?? null,
        checkIn: r.check_in ? new Date(r.check_in).toISOString() : null,
        checkOut: r.check_out ? new Date(r.check_out).toISOString() : null, notes: r.notes ?? null,
      })),
      staff: staffRows.map((s) => ({
        name: s.full_name, email: s.email ?? null, role: s.role, phone: s.phone ?? null,
        onDuty: !!s.on_duty, lastSeen: s.last_seen ? new Date(s.last_seen).toISOString() : null,
        departments: (s.depts ?? []).filter(Boolean),
      })),
      departments: deptKeys.map((d) => {
        const dr = reqRows.filter((r) => r.dept === d);
        return {
          dept: d, mode: modes.find((m) => m.dept === d)?.mode ?? "accept_decline",
          open: dr.filter((r) => r.status === "received").length,
          inProgress: dr.filter((r) => r.status === "in_progress").length,
          resolvedToday: dr.filter((r) => r.resolvedAt && new Date(r.resolvedAt) >= startDay).length,
          offerings: items.find((i) => i.dept === d)?.n ?? 0,
        };
      }),
      requests: reqRows.map((r) => ({
        id: r.id, room: r.roomNumber ?? null, detail: r.requestDetail ?? null, department: r.dept ?? null,
        status: r.status, priority: r.priority, claimedBy: r.claimedBy ?? null, declined: !!r.declined,
        createdAt: new Date(r.createdAt).toISOString(),
        claimedAt: r.claimedAt ? new Date(r.claimedAt).toISOString() : null,
        resolvedAt: r.resolvedAt ? new Date(r.resolvedAt).toISOString() : null,
        revenue: Number(r.revenue ?? 0),
      })),
      missed: missedRows.map((m) => ({ item: m.requested_item, department: m.department ?? null, times: m.n, loss: Number(m.loss ?? 0) })),
      revenue: {
        today: reqRows.filter((r) => new Date(r.createdAt) >= startDay).reduce((s, r) => s + r.revenue, 0),
        week: reqRows.filter((r) => inRange(r.createdAt, 7)).reduce((s, r) => s + r.revenue, 0),
        month: reqRows.reduce((s, r) => s + r.revenue, 0),
        total: reqRows.reduce((s, r) => s + r.revenue, 0),
        byDept: deptKeys.map((d) => ({ dept: d, amount: reqRows.filter((r) => r.dept === d).reduce((s, r) => s + r.revenue, 0) })).filter((x) => x.amount > 0),
      },
    } };
  } catch (e) { return { ok: false, error: e instanceof Error ? e.message : "detail failed" }; }
}

export type PersonRow = {
  name: string; email: string | null; phone: string | null; role: string;
  hotelId: string; hotelName: string;
  departments: string[]; onDuty: boolean; lastSeen: string | null;
  handled30d: number; avgResponseMins: number | null;
};

/** Every person across every hotel, with how much work they have actually handled. */
export async function getAllPeople(): Promise<Result<{ people: PersonRow[]; totals: Record<string, number> }>> {
  try {
    const rows = await prisma.$queryRawUnsafe<any[]>(
      `select su.id, su.full_name, su.email, su.phone, su.role, su.hotel_id, su.last_seen,
              h.name hotel_name,
              (su.last_seen is not null and su.last_seen > now() - interval '120 seconds') on_duty,
              coalesce(array_agg(sd.dept) filter (where sd.active), '{}') depts
         from staff_users su
         left join "Hotel" h on h."hotelId" = su.hotel_id
         left join staff_departments sd on sd.staff_user_id = su.id
        where su.is_active is not false and su.role <> 'founder'
        group by su.id, h.name
        order by h.name nulls last, su.role, su.full_name`);

    const work = await prisma.$queryRawUnsafe<any[]>(
      `select "claimedBy", "hotelId", count(*)::int n,
              avg(extract(epoch from ("claimedAt" - "createdAt"))/60) avg_resp
         from "Request"
        where "claimedBy" is not null and "createdAt" > now() - interval '30 days'
        group by "claimedBy", "hotelId"`);

    const people: PersonRow[] = rows.map((r) => {
      const w = work.find((x) => x.claimedBy === r.full_name && String(x.hotelId) === String(r.hotel_id));
      return {
        name: r.full_name, email: r.email ?? null, phone: r.phone ?? null, role: r.role,
        hotelId: String(r.hotel_id ?? ""), hotelName: r.hotel_name ?? "\u2014",
        departments: (r.depts ?? []).filter(Boolean),
        onDuty: !!r.on_duty,
        lastSeen: r.last_seen ? new Date(r.last_seen).toISOString() : null,
        handled30d: w?.n ?? 0,
        avgResponseMins: w?.avg_resp == null ? null : Math.round(Number(w.avg_resp)),
      };
    });

    return { ok: true, data: { people, totals: {
      total: people.length,
      onDuty: people.filter((p) => p.onDuty).length,
      founders: people.filter((p) => p.role === "founder").length,
      gms: people.filter((p) => p.role === "gm").length,
      staff: people.filter((p) => p.role === "staff").length,
      neverSignedIn: people.filter((p) => !p.lastSeen).length,
    } } };
  } catch (e) { return { ok: false, error: e instanceof Error ? e.message : "people failed" }; }
}

export type Insights = {
  series: { date: string; label: string; revenue: number; requests: number; resolved: number }[];
  growth: { month: string; hotels: number; cumulative: number }[];
  speed: { avgResponseMins: number | null; avgResolveMins: number | null;
           byHotel: { hotelId: string; name: string; response: number | null; resolve: number | null; handled: number }[] };
  demand: { item: string; times: number; revenue: number }[];
  gaps: { item: string; times: number; loss: number; hotels: number }[];
  byDepartment: { dept: string; requests: number; revenue: number; declined: number }[];
  activity: { hotelId: string; hotelName: string; room: string | null; detail: string | null;
              dept: string | null; status: string; at: string }[];
  attention: { hotelId: string; name: string; issue: string; severity: "high" | "medium" }[];
};

/** The deeper platform picture - trends, speed, demand and what needs a look. */
export async function getInsights(days = 30): Promise<Result<Insights>> {
  try {
    const hotels = await prisma.$queryRawUnsafe<any[]>(`select "hotelId", name, "createdAt", "isActive" from "Hotel"`);
    const nameOf = (id: string) => hotels.find((h) => String(h.hotelId) === String(id))?.name ?? id;

    const reqs = await prisma.$queryRawUnsafe<any[]>(
      `select "hotelId", "roomNumber", "requestDetail", department::text dept, status::text status,
              coalesce(declined,false) declined, coalesce("revenueGenerated",0)::float revenue,
              "createdAt", "claimedAt", "resolvedAt"
         from "Request" where "createdAt" > now() - ($1 || ' days')::interval
        order by "createdAt" desc`, String(days));

    // daily series
    const byDay = new Map<string, { revenue: number; requests: number; resolved: number }>();
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(); d.setDate(d.getDate() - i); d.setHours(0, 0, 0, 0);
      byDay.set(d.toISOString().slice(0, 10), { revenue: 0, requests: 0, resolved: 0 });
    }
    for (const r of reqs) {
      const k = new Date(r.createdAt).toISOString().slice(0, 10);
      const e = byDay.get(k); if (!e) continue;
      e.requests += 1; e.revenue += r.revenue;
      if (r.status === "resolved") e.resolved += 1;
    }
    const series = Array.from(byDay.entries()).map(([date, v]) => ({
      date, label: new Date(date).toLocaleDateString(undefined, { month: "short", day: "numeric" }), ...v,
    }));

    // hotels joining over time
    const gMap = new Map<string, number>();
    for (const h of hotels) {
      const k = new Date(h.createdAt).toISOString().slice(0, 7);
      gMap.set(k, (gMap.get(k) ?? 0) + 1);
    }
    let run = 0;
    const growth = Array.from(gMap.entries()).sort().map(([month, n]) => { run += n; return { month, hotels: n, cumulative: run }; });

    // speed
    const mins = (a: any, b: any) => a && b ? (new Date(b).getTime() - new Date(a).getTime()) / 60000 : null;
    const avg = (xs: number[]) => xs.length ? Math.round(xs.reduce((s, x) => s + x, 0) / xs.length) : null;
    const allResp = reqs.map((r) => mins(r.createdAt, r.claimedAt)).filter((x): x is number => x != null && x >= 0);
    const allRes = reqs.map((r) => mins(r.createdAt, r.resolvedAt)).filter((x): x is number => x != null && x >= 0);
    const speedByHotel = hotels.map((h) => {
      const hr = reqs.filter((r) => String(r.hotelId) === String(h.hotelId));
      return {
        hotelId: String(h.hotelId), name: h.name,
        response: avg(hr.map((r) => mins(r.createdAt, r.claimedAt)).filter((x): x is number => x != null && x >= 0)),
        resolve: avg(hr.map((r) => mins(r.createdAt, r.resolvedAt)).filter((x): x is number => x != null && x >= 0)),
        handled: hr.filter((r) => r.status === "resolved").length,
      };
    }).filter((x) => x.handled > 0);

    // what guests ask for
    const dMap = new Map<string, { times: number; revenue: number }>();
    for (const r of reqs) {
      const key = String(r.requestDetail ?? "").trim().toLowerCase().slice(0, 60);
      if (!key) continue;
      const e = dMap.get(key) ?? { times: 0, revenue: 0 };
      e.times += 1; e.revenue += r.revenue; dMap.set(key, e);
    }
    const demand = Array.from(dMap.entries()).map(([item, v]) => ({ item, ...v })).sort((a, b) => b.times - a.times).slice(0, 10);

    // gaps across the platform
    let gaps: Insights["gaps"] = [];
    try {
      const g = await prisma.$queryRawUnsafe<any[]>(
        `select lower(requested_item) item, count(*)::int n, coalesce(sum(estimated_value),0)::float loss,
                count(distinct hotel_id)::int hotels
           from missed_demand where resolved_by_hotel = false
          group by lower(requested_item) order by n desc limit 10`);
      gaps = g.map((x) => ({ item: x.item, times: x.n, loss: Number(x.loss ?? 0), hotels: x.hotels }));
    } catch {}

    // departments across the platform
    const depts = Array.from(new Set(reqs.map((r) => r.dept).filter(Boolean)));
    const byDepartment = depts.map((d) => {
      const dr = reqs.filter((r) => r.dept === d);
      return { dept: d, requests: dr.length, revenue: dr.reduce((s, r) => s + r.revenue, 0), declined: dr.filter((r) => r.declined).length };
    }).sort((a, b) => b.requests - a.requests);

    const activity = reqs.slice(0, 25).map((r) => ({
      hotelId: String(r.hotelId), hotelName: nameOf(r.hotelId),
      room: r.roomNumber ?? null, detail: r.requestDetail ?? null, dept: r.dept ?? null,
      status: r.declined ? "declined" : r.status, at: new Date(r.createdAt).toISOString(),
    }));

    // what needs a look
    const attention: Insights["attention"] = [];
    const staffOn = await prisma.$queryRawUnsafe<any[]>(
      `select hotel_id, count(*) filter (where last_seen > now() - interval '120 seconds')::int on_duty
         from staff_users where is_active is not false and role <> 'founder' group by hotel_id`);
    for (const h of hotels) {
      const id = String(h.hotelId);
      const open = reqs.filter((r) => String(r.hotelId) === id && r.status === "received").length;
      const on = staffOn.find((s) => String(s.hotel_id) === id)?.on_duty ?? 0;
      if (open > 0 && on === 0) attention.push({ hotelId: id, name: h.name, issue: open + " request" + (open === 1 ? "" : "s") + " waiting with no one on duty", severity: "high" });
      else if (open > 3) attention.push({ hotelId: id, name: h.name, issue: open + " requests waiting", severity: "medium" });
      if (!h.isActive) attention.push({ hotelId: id, name: h.name, issue: "Hotel is switched off", severity: "medium" });
    }

    return { ok: true, data: {
      series, growth,
      speed: { avgResponseMins: avg(allResp), avgResolveMins: avg(allRes), byHotel: speedByHotel },
      demand, gaps, byDepartment, activity, attention,
    } };
  } catch (e) { return { ok: false, error: e instanceof Error ? e.message : "insights failed" }; }
}