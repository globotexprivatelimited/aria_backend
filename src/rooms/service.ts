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
      hotelId, roomNumber, opts.guestName ?? null, (opts.guestPhone ?? "").replace(/[^0-9+]/g, "") || null, opts.partySize ?? null, opts.checkOut ?? null,
      opts.checkIn ?? null, opts.notes ?? null);
    if (!rows[0]) return { ok: false, error: "Room not found." };

    // Link to the WhatsApp brain: upsert a PRE-VERIFIED Session so when the guest texts Aria,
    // the brain already knows their room, name and checkout (no verification dance needed).
    if (opts.guestPhone) {
      try {
        const checkOutDate = opts.checkOut ? new Date(opts.checkOut).toISOString().slice(0, 10) : null;
        const customCheckoutTime = opts.checkOut ? new Date(opts.checkOut).toISOString() : null;
        const existing = await prisma.$queryRawUnsafe<any[]>(
          `select id from "Session" where "hotelId"=$1 and "guestPhone"=$2 limit 1`, hotelId, opts.guestPhone);
        if (existing[0]) {
          await prisma.$executeRawUnsafe(
            `update "Session" set "roomNumber"=$3, "guestName"=$4, "checkOutDate"=$5::date, "customCheckoutTime"=$6, "roomVerified"=true, "state"='active', "updatedAt"=now()
             where id=$1 and "guestPhone"=$2`,
            existing[0].id, opts.guestPhone, roomNumber, opts.guestName ?? null, checkOutDate, customCheckoutTime);
        } else {
          await prisma.$executeRawUnsafe(
            `insert into "Session" (id, "hotelId", "guestPhone", "roomNumber", "guestName", "checkOutDate", "customCheckoutTime", "roomVerified", "state", "updatedAt")
             values ($1, $2, $3, $4, $5, $6::date, $7, true, 'active', now())`,
            randomUUID(), hotelId, opts.guestPhone, roomNumber, opts.guestName ?? null, checkOutDate, customCheckoutTime);
        }
      } catch (se) { /* session link is best-effort; room check-in still succeeds */ console.log("session link warn:", se instanceof Error ? se.message : String(se)); }
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
      try { await prisma.$executeRawUnsafe(`update "Session" set "state"='closed', "roomVerified"=false, "updatedAt"=now() where "hotelId"=$1 and "guestPhone"=$2`, hotelId, phone); } catch { /* best-effort */ }
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
}