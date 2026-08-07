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
              coalesce(email_verified,false) email_verified, "revenueSharePercent", "createdAt"
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