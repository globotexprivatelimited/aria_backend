import { prisma } from "../db";
type Result<T> = { ok: true; data: T } | { ok: false; error: string };

// ---------- support tickets ----------
export type TicketReply = { author: string; side: string; body: string; at: string };
export type Ticket = {
  id: string; ref: string; hotelId: string; hotelName: string; raisedBy: string | null;
  subject: string; body: string | null; priority: string; state: string;
  assignedTo: string | null; createdAt: string; updatedAt: string; resolvedAt: string | null;
  replies: TicketReply[];
};

export async function listTickets(): Promise<Result<{ tickets: Ticket[]; totals: Record<string, number> }>> {
  try {
    const rows = await prisma.$queryRawUnsafe<any[]>(
      `select t.*, h.name hotel_name from support_tickets t
         left join "Hotel" h on h."hotelId" = t.hotel_id
        order by case t.state when 'open' then 0 when 'with_aria' then 1 when 'waiting_hotel' then 2 else 3 end,
                 case t.priority when 'urgent' then 0 when 'high' then 1 when 'normal' then 2 else 3 end,
                 t.created_at desc limit 200`);
    const ids = rows.map((r) => r.id);
    let replies: any[] = [];
    if (ids.length) {
      replies = await prisma.$queryRawUnsafe<any[]>(
        `select ticket_id, author, author_side, body, created_at from ticket_replies
          where ticket_id = any($1::uuid[]) order by created_at`, ids);
    }
    const tickets: Ticket[] = rows.map((r) => ({
      id: r.id, ref: r.ref ?? "", hotelId: String(r.hotel_id), hotelName: r.hotel_name ?? "\u2014",
      raisedBy: r.raised_by ?? null, subject: r.subject, body: r.body ?? null,
      priority: r.priority, state: r.state, assignedTo: r.assigned_to ?? null,
      createdAt: new Date(r.created_at).toISOString(), updatedAt: new Date(r.updated_at).toISOString(),
      resolvedAt: r.resolved_at ? new Date(r.resolved_at).toISOString() : null,
      replies: replies.filter((x) => x.ticket_id === r.id).map((x) => ({
        author: x.author, side: x.author_side, body: x.body, at: new Date(x.created_at).toISOString(),
      })),
    }));
    return { ok: true, data: { tickets, totals: {
      open: tickets.filter((t) => t.state !== "resolved").length,
      urgent: tickets.filter((t) => t.priority === "urgent" && t.state !== "resolved").length,
      unassigned: tickets.filter((t) => !t.assignedTo && t.state !== "resolved").length,
      resolved: tickets.filter((t) => t.state === "resolved").length,
    } } };
  } catch (e) { return { ok: false, error: e instanceof Error ? e.message : "tickets failed" }; }
}

export async function createTicket(a: { hotelId: string; raisedBy?: string; subject: string; body?: string; priority?: string }): Promise<Result<{ ref: string }>> {
  if (!a.hotelId || !a.subject) return { ok: false, error: "hotelId and subject required" };
  try {
    const n = await prisma.$queryRawUnsafe<any[]>(`select nextval('ticket_ref_seq') v`);
    const ref = "T-" + n[0].v;
    await prisma.$executeRawUnsafe(
      `insert into support_tickets (ref, hotel_id, raised_by, subject, body, priority)
       values ($1,$2,$3,$4,$5,$6)`,
      ref, a.hotelId, a.raisedBy ?? null, a.subject, a.body ?? null, a.priority ?? "normal");
    return { ok: true, data: { ref } };
  } catch (e) { return { ok: false, error: e instanceof Error ? e.message : "failed" }; }
}

export async function replyToTicket(ticketId: string, author: string, side: string, body: string): Promise<Result<{ ok: true }>> {
  if (!ticketId || !body) return { ok: false, error: "ticketId and body required" };
  try {
    await prisma.$executeRawUnsafe(
      `insert into ticket_replies (ticket_id, author, author_side, body) values ($1::uuid,$2,$3,$4)`,
      ticketId, author, side, body);
    await prisma.$executeRawUnsafe(
      `update support_tickets set updated_at = now(), state = case when state='open' then 'with_aria' else state end where id = $1::uuid`, ticketId);
    return { ok: true, data: { ok: true } };
  } catch (e) { return { ok: false, error: e instanceof Error ? e.message : "failed" }; }
}

export async function updateTicket(ticketId: string, patch: { state?: string; assignedTo?: string | null; priority?: string }): Promise<Result<{ ok: true }>> {
  try {
    if (patch.state) {
      await prisma.$executeRawUnsafe(
        `update support_tickets set state=$2, updated_at=now(),
           resolved_at = case when $2='resolved' then now() else null end where id=$1::uuid`, ticketId, patch.state);
    }
    if (patch.assignedTo !== undefined) {
      await prisma.$executeRawUnsafe(`update support_tickets set assigned_to=$2, updated_at=now() where id=$1::uuid`, ticketId, patch.assignedTo);
    }
    if (patch.priority) {
      await prisma.$executeRawUnsafe(`update support_tickets set priority=$2, updated_at=now() where id=$1::uuid`, ticketId, patch.priority);
    }
    return { ok: true, data: { ok: true } };
  } catch (e) { return { ok: false, error: e instanceof Error ? e.message : "failed" }; }
}

// ---------- incidents ----------
export type Incident = { id: string; hotelId: string | null; hotelName: string | null; kind: string;
  title: string; detail: string | null; severity: string; state: string; createdAt: string; resolvedAt: string | null };

export async function listIncidents(): Promise<Result<{ incidents: Incident[]; open: number }>> {
  try {
    const rows = await prisma.$queryRawUnsafe<any[]>(
      `select i.*, h.name hotel_name from incidents i left join "Hotel" h on h."hotelId" = i.hotel_id
        order by case i.state when 'open' then 0 else 1 end, i.created_at desc limit 100`);
    const incidents = rows.map((r) => ({
      id: r.id, hotelId: r.hotel_id ?? null, hotelName: r.hotel_name ?? null, kind: r.kind,
      title: r.title, detail: r.detail ?? null, severity: r.severity, state: r.state,
      createdAt: new Date(r.created_at).toISOString(),
      resolvedAt: r.resolved_at ? new Date(r.resolved_at).toISOString() : null,
    }));
    return { ok: true, data: { incidents, open: incidents.filter((i) => i.state === "open").length } };
  } catch (e) { return { ok: false, error: e instanceof Error ? e.message : "incidents failed" }; }
}

export async function createIncident(a: { hotelId?: string | null; kind?: string; title: string; detail?: string; severity?: string }): Promise<Result<{ ok: true }>> {
  if (!a.title) return { ok: false, error: "title required" };
  try {
    await prisma.$executeRawUnsafe(
      `insert into incidents (hotel_id, kind, title, detail, severity) values ($1,$2,$3,$4,$5)`,
      a.hotelId ?? null, a.kind ?? "platform", a.title, a.detail ?? null, a.severity ?? "medium");
    return { ok: true, data: { ok: true } };
  } catch (e) { return { ok: false, error: e instanceof Error ? e.message : "failed" }; }
}

export async function resolveIncident(id: string): Promise<Result<{ ok: true }>> {
  try {
    await prisma.$executeRawUnsafe(`update incidents set state='resolved', resolved_at=now() where id=$1::uuid`, id);
    return { ok: true, data: { ok: true } };
  } catch (e) { return { ok: false, error: e instanceof Error ? e.message : "failed" }; }
}

// ---------- stations ----------
export type Station = { id: string; hotelId: string; hotelName: string | null; name: string;
  dept: string | null; lastSeen: string | null; online: boolean; minutesOffline: number | null };

export async function listStations(): Promise<Result<{ stations: Station[]; totals: Record<string, number> }>> {
  try {
    const rows = await prisma.$queryRawUnsafe<any[]>(
      `select s.*, h.name hotel_name from stations s left join "Hotel" h on h."hotelId" = s.hotel_id
        where s.is_active order by h.name, s.name`);
    const stations = rows.map((r) => {
      const mins = r.last_seen ? Math.round((Date.now() - new Date(r.last_seen).getTime()) / 60000) : null;
      return {
        id: r.id, hotelId: String(r.hotel_id), hotelName: r.hotel_name ?? null, name: r.name,
        dept: r.dept ?? null, lastSeen: r.last_seen ? new Date(r.last_seen).toISOString() : null,
        online: mins != null && mins < 15, minutesOffline: mins,
      };
    });
    return { ok: true, data: { stations, totals: {
      total: stations.length,
      online: stations.filter((s) => s.online).length,
      offline: stations.filter((s) => !s.online).length,
    } } };
  } catch (e) { return { ok: false, error: e instanceof Error ? e.message : "stations failed" }; }
}

export async function upsertStation(a: { hotelId: string; name: string; dept?: string }): Promise<Result<{ ok: true }>> {
  if (!a.hotelId || !a.name) return { ok: false, error: "hotelId and name required" };
  try {
    await prisma.$executeRawUnsafe(
      `insert into stations (hotel_id, name, dept, last_seen) values ($1,$2,$3, now())`, a.hotelId, a.name, a.dept ?? null);
    return { ok: true, data: { ok: true } };
  } catch (e) { return { ok: false, error: e instanceof Error ? e.message : "failed" }; }
}

/** A hotel sees only its own tickets. */
export async function listHotelTickets(hotelId: string): Promise<Result<{ tickets: Ticket[] }>> {
  if (!hotelId) return { ok: false, error: "hotelId required" };
  try {
    const rows = await prisma.$queryRawUnsafe<any[]>(
      `select t.*, h.name hotel_name from support_tickets t
         left join "Hotel" h on h."hotelId" = t.hotel_id
        where t.hotel_id = $1
        order by case t.state when 'resolved' then 1 else 0 end, t.created_at desc limit 50`, hotelId);
    const ids = rows.map((r) => r.id);
    let replies: any[] = [];
    if (ids.length) {
      replies = await prisma.$queryRawUnsafe<any[]>(
        `select ticket_id, author, author_side, body, created_at from ticket_replies
          where ticket_id = any($1::uuid[]) order by created_at`, ids);
    }
    const tickets: Ticket[] = rows.map((r) => ({
      id: r.id, ref: r.ref ?? "", hotelId: String(r.hotel_id), hotelName: r.hotel_name ?? "",
      raisedBy: r.raised_by ?? null, subject: r.subject, body: r.body ?? null,
      priority: r.priority, state: r.state, assignedTo: r.assigned_to ?? null,
      createdAt: new Date(r.created_at).toISOString(), updatedAt: new Date(r.updated_at).toISOString(),
      resolvedAt: r.resolved_at ? new Date(r.resolved_at).toISOString() : null,
      replies: replies.filter((x) => x.ticket_id === r.id).map((x) => ({
        author: x.author, side: x.author_side, body: x.body, at: new Date(x.created_at).toISOString(),
      })),
    }));
    return { ok: true, data: { tickets } };
  } catch (e) { return { ok: false, error: e instanceof Error ? e.message : "failed" }; }
}

/** The hotel replying on its own ticket - never on someone else's. */
export async function hotelReply(hotelId: string, ticketId: string, author: string, body: string): Promise<Result<{ ok: true }>> {
  if (!ticketId || !body) return { ok: false, error: "ticketId and body required" };
  try {
    const own = await prisma.$queryRawUnsafe<any[]>(`select id from support_tickets where id=$1::uuid and hotel_id=$2`, ticketId, hotelId);
    if (!own[0]) return { ok: false, error: "Not your ticket." };
    await prisma.$executeRawUnsafe(
      `insert into ticket_replies (ticket_id, author, author_side, body) values ($1::uuid,$2,'hotel',$3)`, ticketId, author, body);
    await prisma.$executeRawUnsafe(
      `update support_tickets set updated_at = now(), state = case when state='waiting_hotel' then 'open' else state end where id=$1::uuid`, ticketId);
    return { ok: true, data: { ok: true } };
  } catch (e) { return { ok: false, error: e instanceof Error ? e.message : "failed" }; }
}

/** A station checks in. Called by whatever device or portal represents it. */
export async function stationHeartbeat(hotelId: string, dept: string): Promise<Result<{ ok: true }>> {
  if (!hotelId || !dept) return { ok: false, error: "hotelId and dept required" };
  try {
    const n = await prisma.$executeRawUnsafe(
      `update stations set last_seen = now() where hotel_id = $1 and dept = $2 and is_active`, hotelId, dept);
    if (Number(n) === 0) {
      await prisma.$executeRawUnsafe(
        `insert into stations (hotel_id, name, dept, last_seen) values ($1, $2, $3, now())`,
        hotelId, dept.replace(/_/g, " ").replace(/\b\w/g, (m) => m.toUpperCase()), dept);
    }
    return { ok: true, data: { ok: true } };
  } catch (e) { return { ok: false, error: e instanceof Error ? e.message : "failed" }; }
}

export async function deleteStation(id: string): Promise<Result<{ ok: true }>> {
  try {
    await prisma.$executeRawUnsafe(`update stations set is_active = false where id = $1::uuid`, id);
    return { ok: true, data: { ok: true } };
  } catch (e) { return { ok: false, error: e instanceof Error ? e.message : "failed" }; }
}

/** Record what the platform actually costs. */
export async function addCost(a: { category: string; amount: number; note?: string }): Promise<Result<{ ok: true }>> {
  if (!a.category || !(a.amount > 0)) return { ok: false, error: "category and a positive amount required" };
  try {
    await prisma.$executeRawUnsafe(
      `insert into platform_costs (category, amount, note) values ($1,$2,$3)`, a.category, a.amount, a.note ?? null);
    return { ok: true, data: { ok: true } };
  } catch (e) { return { ok: false, error: e instanceof Error ? e.message : "failed" }; }
}