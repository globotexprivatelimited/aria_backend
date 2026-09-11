import { checkInGuest, checkOutGuest } from "../lib/frontdesk";
import { prisma } from "../db";
import { randomUUID } from "crypto";
type Result<T> = { ok: true; data: T } | { ok: false; error: string };
function iso(d: any) { return d instanceof Date ? d.toISOString() : d; }
function norm(r: any) { return { ...r, floor: Number(r.floor), party_size: r.party_size == null ? null : Number(r.party_size), check_in: iso(r.check_in), check_out: iso(r.check_out), created_at: iso(r.created_at) }; }

// list all rooms for a hotel (the live board)
export async function listRooms(hotelId: string): Promise<Result<any[]>> {
  if (!hotelId) return { ok: false, error: "hotelId required" };
  try {
    const rows = await prisma.$queryRawUnsafe<any[]>(`select * from rooms where hotel_id = $1 order by floor, room_number`, hotelId);
    return { ok: true, data: rows.map(norm) };
  } catch (e) { return { ok: false, error: e instanceof Error ? e.message : "Could not load rooms." }; }
}

// bulk setup: generate rooms across floors. floors=[{floor, count, type, startNum}]
export async function setupRooms(hotelId: string, floors: { floor: number; count: number; type?: string; prefix?: string }[]): Promise<Result<{ created: number }>> {
  if (!hotelId || !floors?.length) return { ok: false, error: "hotelId and floors required" };
  try {
    let created = 0;
    for (const f of floors) {
      for (let i = 1; i <= f.count; i++) {
        const num = (f.prefix ?? String(f.floor)) + String(i).padStart(2, "0");
        await prisma.$executeRawUnsafe(
          `insert into rooms (hotel_id, room_number, room_type, floor, status) values ($1,$2,$3,$4,'available')
           on conflict (hotel_id, room_number) do nothing`,
          hotelId, num, f.type ?? "Standard", f.floor);
        created++;
      }
    }
    return { ok: true, data: { created } };
  } catch (e) { return { ok: false, error: e instanceof Error ? e.message : "Could not set up rooms." }; }
}

// add or update a single room
export async function upsertRoom(hotelId: string, room: { room_number: string; room_type?: string; floor?: number }): Promise<Result<any>> {
  if (!hotelId || !room?.room_number) return { ok: false, error: "room_number required" };
  try {
    const rows = await prisma.$queryRawUnsafe<any[]>(
      `insert into rooms (hotel_id, room_number, room_type, floor) values ($1,$2,$3,$4)
       on conflict (hotel_id, room_number) do update set room_type=$3, floor=$4 returning *`,
      hotelId, room.room_number, room.room_type ?? "Standard", room.floor ?? 1);
    return { ok: true, data: norm(rows[0]) };
  } catch (e) { return { ok: false, error: e instanceof Error ? e.message : "Could not save room." }; }
}

// check a guest into a room (sets occupied + times)
export async function checkInRoom(hotelId: string, roomNumber: string, opts: { guestName?: string; guestPhone?: string; partySize?: number; checkOut?: string; checkIn?: string; notes?: string }): Promise<Result<any>> {
  if (!hotelId || !roomNumber) return { ok: false, error: "roomNumber required" };
  try {
    const rows = await prisma.$queryRawUnsafe<any[]>(
      `update rooms set status='occupied', guest_name=$3, guest_phone=$4, party_size=$5,
              check_in=coalesce($7::timestamptz, now()), check_out=$6::timestamptz, notes=coalesce($8, notes)
       where hotel_id=$1 and room_number=$2 returning *`,
      hotelId, roomNumber, opts.guestName ?? null, (opts.guestPhone ?? "").replace(/[^0-9+]/g, "") || null, opts.partySize ?? 1, opts.checkOut ?? null,
      opts.checkIn ?? null, opts.notes ?? null);
    if (!rows[0]) return { ok: false, error: "Room not found." };

    // Link to the WhatsApp brain through the one shared check-in path: canonical phone, verified session, welcome template, stay triggers.
    if (opts.guestPhone) {
      try {
        const session = await checkInGuest(hotelId, roomNumber, opts.guestName ?? "Guest", opts.guestPhone, opts.checkOut ?? null);
        const customCheckoutTime = opts.checkOut ? new Date(opts.checkOut).toISOString() : null;
        await prisma.$executeRawUnsafe(`update "Session" set "guestName"=$2, "customCheckoutTime"=$3, "updatedAt"=now() where id=$1`, session.id, opts.guestName ?? null, customCheckoutTime);
      } catch (se) { /* session link is best-effort; room check-in still succeeds */ console.log("CHECK-IN SESSION LINK FAILED - this guest will not be recognised on WhatsApp:", se instanceof Error ? se.message : String(se)); }
    }

    return { ok: true, data: norm(rows[0]) };
  } catch (e) { return { ok: false, error: e instanceof Error ? e.message : "Could not check in." }; }
}

// check out (frees the room, sets to cleaning)
export async function checkOutRoom(hotelId: string, roomNumber: string): Promise<Result<any>> {
  if (!hotelId || !roomNumber) return { ok: false, error: "roomNumber required" };
  try {
    // grab the guest phone before clearing, to close their Session
    const before = await prisma.$queryRawUnsafe<any[]>(`select guest_phone from rooms where hotel_id=$1 and room_number=$2`, hotelId, roomNumber);
    const phone = before[0]?.guest_phone;
    const rows = await prisma.$queryRawUnsafe<any[]>(
      `update rooms set status='cleaning', guest_name=null, guest_phone=null, party_size=null, check_in=null, check_out=null
       where hotel_id=$1 and room_number=$2 returning *`,
      hotelId, roomNumber);
    if (!rows[0]) return { ok: false, error: "Room not found." };
    // close the guest's Session so the brain knows they've left
    if (phone) {
      try { await checkOutGuest(hotelId, { phone }); } catch { /* best-effort */ }
    }
    return { ok: true, data: norm(rows[0]) };
  } catch (e) { return { ok: false, error: e instanceof Error ? e.message : "Could not check out." }; }
}

// mark a room clean -> available
export async function markClean(hotelId: string, roomNumber: string): Promise<Result<any>> {
  if (!hotelId || !roomNumber) return { ok: false, error: "roomNumber required" };
  try {
    const rows = await prisma.$queryRawUnsafe<any[]>(`update rooms set status='available' where hotel_id=$1 and room_number=$2 returning *`, hotelId, roomNumber);
    if (!rows[0]) return { ok: false, error: "Room not found." };
    return { ok: true, data: norm(rows[0]) };
  } catch (e) { return { ok: false, error: e instanceof Error ? e.message : "Could not update." }; }
}

// occupancy summary
export async function roomStats(hotelId: string): Promise<Result<any>> {
  if (!hotelId) return { ok: false, error: "hotelId required" };
  try {
    const rows = await prisma.$queryRawUnsafe<any[]>(`select status, count(*) n from rooms where hotel_id=$1 group by status`, hotelId);
    const by: Record<string, number> = { available: 0, occupied: 0, cleaning: 0 };
    let total = 0;
    for (const r of rows) { by[r.status] = Number(r.n); total += Number(r.n); }
    return { ok: true, data: { total, ...by, occupancyPct: total ? Math.round((by.occupied / total) * 100) : 0 } };
  } catch (e) { return { ok: false, error: e instanceof Error ? e.message : "Could not load stats." }; }
}

export async function editRoom(hotelId: string, roomNumber: string, changes: { room_type?: string; floor?: number; newNumber?: string }): Promise<Result<any>> {
  if (!hotelId || !roomNumber) return { ok: false, error: "roomNumber required" };
  try {
    if (changes.newNumber && changes.newNumber !== roomNumber) {
      const clash = await prisma.$queryRawUnsafe<any[]>(`select 1 from rooms where hotel_id=$1 and room_number=$2`, hotelId, changes.newNumber);
      if (clash[0]) return { ok: false, error: "Room " + changes.newNumber + " already exists." };
    }
    const rows = await prisma.$queryRawUnsafe<any[]>(
      `update rooms set room_type=coalesce($3, room_type), floor=coalesce($4, floor), room_number=coalesce($5, room_number)
       where hotel_id=$1 and room_number=$2 returning *`,
      hotelId, roomNumber, changes.room_type ?? null, changes.floor ?? null, changes.newNumber ?? null);
    if (!rows[0]) return { ok: false, error: "Room not found." };
    return { ok: true, data: norm(rows[0]) };
  } catch (e) { return { ok: false, error: e instanceof Error ? e.message : "Could not edit room." }; }
}

export async function deleteRoom(hotelId: string, roomNumber: string): Promise<Result<{ deleted: boolean }>> {
  if (!hotelId || !roomNumber) return { ok: false, error: "roomNumber required" };
  try {
    const chk = await prisma.$queryRawUnsafe<any[]>(`select status from rooms where hotel_id=$1 and room_number=$2`, hotelId, roomNumber);
    if (!chk[0]) return { ok: false, error: "Room not found." };
    if (chk[0].status === 'occupied') return { ok: false, error: "Check the guest out before deleting this room." };
    await prisma.$executeRawUnsafe(`delete from rooms where hotel_id=$1 and room_number=$2`, hotelId, roomNumber);
    return { ok: true, data: { deleted: true } };
  } catch (e) { return { ok: false, error: e instanceof Error ? e.message : "Could not delete room." }; }
}

export async function clearFloor(hotelId: string, floor: number): Promise<Result<{ deleted: number }>> {
  if (!hotelId || floor == null) return { ok: false, error: "floor required" };
  try {
    const occ = await prisma.$queryRawUnsafe<any[]>(`select count(*) n from rooms where hotel_id=$1 and floor=$2 and status='occupied'`, hotelId, floor);
    if (Number(occ[0].n) > 0) return { ok: false, error: "Floor " + floor + " has occupied rooms. Check those guests out first." };
    const before = await prisma.$queryRawUnsafe<any[]>(`select count(*) n from rooms where hotel_id=$1 and floor=$2`, hotelId, floor);
    await prisma.$executeRawUnsafe(`delete from rooms where hotel_id=$1 and floor=$2`, hotelId, floor);
    return { ok: true, data: { deleted: Number(before[0].n) } };
  } catch (e) { return { ok: false, error: e instanceof Error ? e.message : "Could not clear floor." }; }
}

// the room_count the GM entered at registration - the target to organize
export async function hotelRoomTarget(hotelId: string): Promise<Result<{ target: number; created: number }>> {
  if (!hotelId) return { ok: false, error: "hotelId required" };
  try {
    const h = await prisma.$queryRawUnsafe<any[]>(`select room_count from "Hotel" where "hotelId"=$1`, hotelId);
    const created = await prisma.$queryRawUnsafe<any[]>(`select count(*) n from rooms where hotel_id=$1`, hotelId);
    return { ok: true, data: { target: Number(h[0]?.room_count ?? 0), created: Number(created[0].n) } };
  } catch (e) { return { ok: false, error: e instanceof Error ? e.message : "failed" }; }
}import { hotelTimezone, zonedAt, formatLocal } from "../lib/localtime";

/* ---------------------------------------------------------------- checkout time ---- */

/**
 * A stay's checkout time lives in three places - the room board, the guest's session, and the
 * nudge we send before they leave. This moves all three together, so extending or shortening a
 * stay from the room modal cannot leave the brain promising one thing and the board showing another.
 */
export async function setCheckout(
  hotelId: string,
  roomNumber: string,
  newCheckout: string,
  opts: { by?: string | null; reason?: string | null } = {}
): Promise<Result<any>> {
  if (!hotelId || !roomNumber || !newCheckout) return { ok: false, error: "hotelId, roomNumber and a new checkout time are required" };
  const next = new Date(newCheckout);
  if (Number.isNaN(next.getTime())) return { ok: false, error: "That checkout time is not a valid date." };
  const now = new Date();
  if (next.getTime() > now.getTime() + 365 * 86400000) return { ok: false, error: "That checkout is more than a year away - please check the date." };

  try {
    const tz = await hotelTimezone(hotelId);
    const before = await prisma.$queryRawUnsafe<any[]>(`select * from rooms where hotel_id=$1 and room_number=$2`, hotelId, roomNumber);
    const room = before[0];
    if (!room) return { ok: false, error: "Room not found." };
    if (room.status !== "occupied") return { ok: false, error: "Room " + roomNumber + " is not occupied - there is no stay to change." };

    const checkIn = room.check_in ? new Date(room.check_in) : null;
    if (checkIn && next.getTime() <= checkIn.getTime()) return { ok: false, error: "Checkout has to be after the check-in time." };
    // a checkout in the past is an ended stay, not a shorter one - that is the Check out button's job
    if (next.getTime() <= now.getTime()) return { ok: false, error: "That time has already passed. Use Check out guest to end the stay now." };

    const previous = room.check_out ? new Date(room.check_out) : null;
    const rows = await prisma.$queryRawUnsafe<any[]>(
      `update rooms set check_out=$3::timestamptz where hotel_id=$1 and room_number=$2 returning *`,
      hotelId, roomNumber, next.toISOString());
    if (!rows[0]) return { ok: false, error: "Could not update the room." };

    // the guest's live session carries the same time, so Aria and the board never disagree
    const phone: string | null = room.guest_phone ?? null;
    let sessionId: string | null = null;
    if (phone) {
      const session = await prisma.session.findFirst({ where: { hotelId, guestPhone: phone }, orderBy: { createdAt: "desc" } });
      if (session) {
        sessionId = session.id;
        await prisma.session.update({ where: { id: session.id }, data: { checkOutDate: next, customCheckoutTime: next.toISOString() } });
        await rearmPreCheckout(hotelId, session.id, phone, next, now, tz);
      }
    }

    await recordStayEvent({ hotelId, roomNumber, sessionId, guestPhone: phone, previous, next, by: opts.by ?? null, reason: opts.reason ?? null });
    return {
      ok: true,
      data: {
        room: norm(rows[0]),
        previousCheckout: previous ? previous.toISOString() : null,
        checkout: next.toISOString(),
        sessionUpdated: !!sessionId,
        guestMessage: guestCheckoutLine(previous, next, tz),
      },
    };
  } catch (e) { return { ok: false, error: e instanceof Error ? e.message : "Could not change the checkout time." }; }
}

/** The sentence the front desk can send the guest, if they choose to tell them. */
function guestCheckoutLine(previous: Date | null, next: Date, tz: string | null): string {
  const when = formatLocal(next, tz);
  const longer = previous ? next.getTime() > previous.getTime() : false;
  return (previous && longer ? "Good news - your checkout has been extended to " : "Your checkout is now ") + when + ".";
}

/**
 * Move the pre-checkout nudge with the stay: drop the one that is still waiting and set a new one.
 * Normally that is the evening before; for a short extension the evening is already gone, so we
 * aim a few hours ahead of the new time instead, and skip it entirely when that is too close.
 */
async function rearmPreCheckout(hotelId: string, sessionId: string, guestPhone: string, checkout: Date, now: Date, tz: string | null): Promise<void> {
  try {
    await prisma.proactiveTrigger.deleteMany({ where: { sessionId, triggerType: "pre_checkout" as never, status: "pending" as never } });
    let at = zonedAt(checkout, tz, 19, 0, -1);
    if (at.getTime() <= now.getTime()) at = new Date(checkout.getTime() - 3 * 3600 * 1000);
    if (at.getTime() <= now.getTime() + 5 * 60000) return;
    await prisma.proactiveTrigger.create({
      data: { hotelId, sessionId, guestPhone, triggerType: "pre_checkout" as never, scheduledAt: at, status: "pending" as never },
    });
  } catch (e) { console.log("pre-checkout re-arm warn:", e instanceof Error ? e.message : String(e)); }
}

let stayEventsReady = false;

/** Every change to a stay is written down - a disputed late checkout should have a record, not a memory. */
async function recordStayEvent(e: {
  hotelId: string; roomNumber: string; sessionId: string | null; guestPhone: string | null;
  previous: Date | null; next: Date; by: string | null; reason: string | null;
}): Promise<void> {
  try {
    if (!stayEventsReady) {
      await prisma.$executeRawUnsafe(
        `create table if not exists stay_events (
           id uuid primary key default gen_random_uuid(),
           hotel_id text not null, room_number text not null, session_id text, guest_phone text,
           kind text not null default 'checkout_changed',
           previous_at timestamptz, new_at timestamptz, changed_by text, reason text,
           created_at timestamptz not null default now())`);
      await prisma.$executeRawUnsafe(`create index if not exists stay_events_hotel_idx on stay_events (hotel_id, created_at desc)`);
      stayEventsReady = true;
    }
    await prisma.$executeRawUnsafe(
      `insert into stay_events (hotel_id, room_number, session_id, guest_phone, kind, previous_at, new_at, changed_by, reason)
       values ($1,$2,$3,$4,'checkout_changed',$5::timestamptz,$6::timestamptz,$7,$8)`,
      e.hotelId, e.roomNumber, e.sessionId, e.guestPhone, e.previous ? e.previous.toISOString() : null, e.next.toISOString(), e.by, e.reason);
  } catch (err) { console.log("stay event warn:", err instanceof Error ? err.message : String(err)); }
}

/** What has been changed on a stay, newest first - for the room modal and for revenue questions later. */
export async function stayEvents(hotelId: string, roomNumber?: string, limit = 20): Promise<Result<any[]>> {
  if (!hotelId) return { ok: false, error: "hotelId required" };
  try {
    const rows = roomNumber
      ? await prisma.$queryRawUnsafe<any[]>(`select * from stay_events where hotel_id=$1 and room_number=$2 order by created_at desc limit $3`, hotelId, roomNumber, limit)
      : await prisma.$queryRawUnsafe<any[]>(`select * from stay_events where hotel_id=$1 order by created_at desc limit $2`, hotelId, limit);
    return { ok: true, data: rows.map((r: any) => ({
      room: r.room_number, kind: r.kind, previousAt: iso(r.previous_at), newAt: iso(r.new_at),
      by: r.changed_by ?? null, reason: r.reason ?? null, at: iso(r.created_at),
    })) };
  } catch (e) { return { ok: false, error: e instanceof Error ? e.message : "Could not load stay history." }; }
}

/** Keep the room board in step when a PMS moves a checkout through the universal API. */
export async function syncRoomCheckout(hotelId: string, roomNumber: string | undefined, newCheckout: string): Promise<void> {
  if (!hotelId || !roomNumber || !newCheckout) return;
  try {
    await prisma.$executeRawUnsafe(`update rooms set check_out=$3::timestamptz where hotel_id=$1 and room_number=$2 and status='occupied'`, hotelId, roomNumber, new Date(newCheckout).toISOString());
  } catch (e) { console.log("room checkout sync warn:", e instanceof Error ? e.message : String(e)); }
}
