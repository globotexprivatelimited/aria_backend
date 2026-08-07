import { prisma } from "../db";
type Result<T> = { ok: true; data: T } | { ok: false; error: string };

const DAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const dayOf = (isoDate: string) => DAY_KEYS[new Date(isoDate + "T12:00:00").getDay()];

export type Slot = {
  id: string; itemId: string | null; itemName: string | null;
  label: string; startTime: string; endTime: string | null;
  capacity: number; days: string[]; active: boolean;
};

/** Every slot a department offers, with the treatment each belongs to. */
export async function listSlots(hotelId: string, dept: string): Promise<Result<Slot[]>> {
  if (!hotelId || !dept) return { ok: false, error: "hotelId and dept required" };
  try {
    const rows = await prisma.$queryRawUnsafe<any[]>(
      `select s.*, i.name item_name
         from time_slots s
         left join dept_items i on i.id = s.item_id
        where s.hotel_id = $1 and s.dept = $2
        order by s.start_time, s.label`, hotelId, dept);
    return { ok: true, data: rows.map((r) => ({
      id: r.id, itemId: r.item_id ?? null, itemName: r.item_name ?? null,
      label: r.label, startTime: r.start_time, endTime: r.end_time ?? null,
      capacity: Number(r.capacity ?? 1),
      days: String(r.days ?? "").split(",").filter(Boolean),
      active: r.active !== false,
    })) };
  } catch (e) { return { ok: false, error: e instanceof Error ? e.message : "failed" }; }
}

export async function addSlot(a: {
  hotelId: string; dept: string; itemId?: string | null; label: string;
  startTime: string; endTime?: string | null; capacity?: number; days?: string[];
}): Promise<Result<{ ok: true }>> {
  if (!a.hotelId || !a.dept || !a.startTime) return { ok: false, error: "hotelId, dept and a start time are required" };
  try {
    await prisma.$executeRawUnsafe(
      `insert into time_slots (hotel_id, dept, item_id, label, start_time, end_time, capacity, days, active)
       values ($1,$2,$3::uuid,$4,$5,$6,$7,$8,true)`,
      a.hotelId, a.dept, a.itemId || null, a.label || a.startTime, a.startTime,
      a.endTime || null, a.capacity ?? 1,
      (a.days && a.days.length ? a.days : DAY_KEYS.slice(1).concat("sun")).join(","));
    return { ok: true, data: { ok: true } };
  } catch (e) { return { ok: false, error: e instanceof Error ? e.message : "failed" }; }
}

export async function updateSlot(id: string, patch: { capacity?: number; active?: boolean; days?: string[]; label?: string }): Promise<Result<{ ok: true }>> {
  try {
    if (patch.capacity != null) await prisma.$executeRawUnsafe(`update time_slots set capacity=$2 where id=$1::uuid`, id, patch.capacity);
    if (patch.active != null) await prisma.$executeRawUnsafe(`update time_slots set active=$2 where id=$1::uuid`, id, patch.active);
    if (patch.days) await prisma.$executeRawUnsafe(`update time_slots set days=$2 where id=$1::uuid`, id, patch.days.join(","));
    if (patch.label) await prisma.$executeRawUnsafe(`update time_slots set label=$2 where id=$1::uuid`, id, patch.label);
    return { ok: true, data: { ok: true } };
  } catch (e) { return { ok: false, error: e instanceof Error ? e.message : "failed" }; }
}

export async function deleteSlot(id: string): Promise<Result<{ ok: true }>> {
  try {
    await prisma.$executeRawUnsafe(`delete from time_slots where id=$1::uuid`, id);
    return { ok: true, data: { ok: true } };
  } catch (e) { return { ok: false, error: e instanceof Error ? e.message : "failed" }; }
}

export type Availability = {
  slotId: string; label: string; startTime: string; endTime: string | null;
  itemId: string | null; itemName: string | null;
  capacity: number; booked: number; free: number;
};

/** What is actually free on a given date - this is what Aria offers a guest. */
export async function getAvailability(hotelId: string, dept: string, onDate: string, itemId?: string | null): Promise<Result<Availability[]>> {
  if (!hotelId || !dept || !onDate) return { ok: false, error: "hotelId, dept and date required" };
  try {
    const day = dayOf(onDate);
    const rows = await prisma.$queryRawUnsafe<any[]>(
      `select s.*, i.name item_name,
              coalesce((select sum(b.party_size)::int from slot_bookings b
                         where b.slot_id = s.id and b.on_date = $3::date and b.state <> 'cancelled'), 0) booked
         from time_slots s
         left join dept_items i on i.id = s.item_id
        where s.hotel_id = $1 and s.dept = $2 and s.active
          and position($4 in s.days) > 0
          and ($5::uuid is null or s.item_id = $5::uuid or s.item_id is null)
        order by s.start_time`, hotelId, dept, onDate, day, itemId || null);

    return { ok: true, data: rows.map((r) => {
      const capacity = Number(r.capacity ?? 1);
      const booked = Number(r.booked ?? 0);
      return {
        slotId: r.id, label: r.label, startTime: r.start_time, endTime: r.end_time ?? null,
        itemId: r.item_id ?? null, itemName: r.item_name ?? null,
        capacity, booked, free: Math.max(0, capacity - booked),
      };
    }) };
  } catch (e) { return { ok: false, error: e instanceof Error ? e.message : "failed" }; }
}

/** Book a slot. Capacity is enforced here, so an overbooking is refused rather than silently accepted. */
export async function bookSlot(a: {
  hotelId: string; slotId: string; onDate: string; roomNumber?: string;
  guestName?: string; guestPhone?: string; partySize?: number; note?: string; requestId?: string;
}): Promise<Result<{ booked: true; label: string }>> {
  if (!a.hotelId || !a.slotId || !a.onDate) return { ok: false, error: "slot and date required" };
  const size = Math.max(1, a.partySize ?? 1);
  try {
    const s = await prisma.$queryRawUnsafe<any[]>(
      `select id, label, capacity, item_id, days, active from time_slots where id=$1::uuid and hotel_id=$2`, a.slotId, a.hotelId);
    if (!s[0]) return { ok: false, error: "That slot does not exist." };
    if (s[0].active === false) return { ok: false, error: "That slot is not being offered." };
    if (String(s[0].days ?? "").indexOf(dayOf(a.onDate)) < 0) return { ok: false, error: "That slot does not run on that day." };

    const taken = await prisma.$queryRawUnsafe<any[]>(
      `select coalesce(sum(party_size),0)::int n from slot_bookings
        where slot_id=$1::uuid and on_date=$2::date and state <> 'cancelled'`, a.slotId, a.onDate);
    const booked = Number(taken[0]?.n ?? 0);
    const capacity = Number(s[0].capacity ?? 1);
    if (booked + size > capacity) {
      const free = Math.max(0, capacity - booked);
      return { ok: false, error: free === 0 ? "That time is fully booked." : "Only " + free + " place" + (free === 1 ? "" : "s") + " left at that time." };
    }

    await prisma.$executeRawUnsafe(
      `insert into slot_bookings (hotel_id, slot_id, item_id, on_date, room_number, guest_name, guest_phone, party_size, note, request_id)
       values ($1,$2::uuid,$3::uuid,$4::date,$5,$6,$7,$8,$9,$10)`,
      a.hotelId, a.slotId, s[0].item_id ?? null, a.onDate, a.roomNumber ?? null,
      a.guestName ?? null, a.guestPhone ?? null, size, a.note ?? null, a.requestId ?? null);

    return { ok: true, data: { booked: true, label: s[0].label } };
  } catch (e) { return { ok: false, error: e instanceof Error ? e.message : "failed" }; }
}

export type BookingRow = {
  id: string; slotLabel: string; startTime: string; itemName: string | null;
  onDate: string; room: string | null; guestName: string | null; partySize: number; state: string; note: string | null;
};

export async function listBookings(hotelId: string, dept: string, onDate: string): Promise<Result<BookingRow[]>> {
  try {
    const rows = await prisma.$queryRawUnsafe<any[]>(
      `select b.*, s.label, s.start_time, i.name item_name
         from slot_bookings b
         join time_slots s on s.id = b.slot_id
         left join dept_items i on i.id = b.item_id
        where b.hotel_id = $1 and s.dept = $2 and b.on_date = $3::date
        order by s.start_time`, hotelId, dept, onDate);
    return { ok: true, data: rows.map((r) => ({
      id: r.id, slotLabel: r.label, startTime: r.start_time, itemName: r.item_name ?? null,
      onDate: new Date(r.on_date).toISOString().slice(0, 10),
      room: r.room_number ?? null, guestName: r.guest_name ?? null,
      partySize: Number(r.party_size ?? 1), state: r.state, note: r.note ?? null,
    })) };
  } catch (e) { return { ok: false, error: e instanceof Error ? e.message : "failed" }; }
}

export async function cancelBooking(id: string): Promise<Result<{ ok: true }>> {
  try {
    await prisma.$executeRawUnsafe(`update slot_bookings set state='cancelled' where id=$1::uuid`, id);
    return { ok: true, data: { ok: true } };
  } catch (e) { return { ok: false, error: e instanceof Error ? e.message : "failed" }; }
}

// ---- the original department-level slot editor (kept working) ----

/** Old signature: dept optional, returns every slot for the hotel. */
export async function listSlotsLegacy(hotelId: string, dept?: string): Promise<Result<any[]>> {
  try {
    const rows = dept
      ? await prisma.$queryRawUnsafe<any[]>(`select * from time_slots where hotel_id=$1 and dept=$2 order by sort_order, start_time`, hotelId, dept)
      : await prisma.$queryRawUnsafe<any[]>(`select * from time_slots where hotel_id=$1 order by dept, sort_order, start_time`, hotelId);
    return { ok: true, data: rows };
  } catch (e) { return { ok: false, error: e instanceof Error ? e.message : "failed" }; }
}

export async function createSlot(hotelId: string, dept: string, slot: any): Promise<Result<{ ok: true }>> {
  try {
    await prisma.$executeRawUnsafe(
      `insert into time_slots (hotel_id, dept, label, start_time, capacity, active, sort_order)
       values ($1,$2,$3,$4,$5,true,$6)`,
      hotelId, dept, slot.label ?? slot.start_time ?? "Slot", slot.start_time ?? slot.startTime ?? "",
      Number(slot.capacity ?? 1), Number(slot.sort_order ?? 0));
    return { ok: true, data: { ok: true } };
  } catch (e) { return { ok: false, error: e instanceof Error ? e.message : "failed" }; }
}

export async function updateSlotLegacy(hotelId: string, id: string, fields: any): Promise<Result<{ ok: true }>> {
  try {
    if (fields.label != null) await prisma.$executeRawUnsafe(`update time_slots set label=$3 where id=$1::uuid and hotel_id=$2`, id, hotelId, fields.label);
    if (fields.start_time != null) await prisma.$executeRawUnsafe(`update time_slots set start_time=$3 where id=$1::uuid and hotel_id=$2`, id, hotelId, fields.start_time);
    if (fields.capacity != null) await prisma.$executeRawUnsafe(`update time_slots set capacity=$3 where id=$1::uuid and hotel_id=$2`, id, hotelId, Number(fields.capacity));
    if (fields.active != null) await prisma.$executeRawUnsafe(`update time_slots set active=$3 where id=$1::uuid and hotel_id=$2`, id, hotelId, !!fields.active);
    return { ok: true, data: { ok: true } };
  } catch (e) { return { ok: false, error: e instanceof Error ? e.message : "failed" }; }
}

export async function deleteSlotLegacy(hotelId: string, id: string): Promise<Result<{ ok: true }>> {
  try {
    await prisma.$executeRawUnsafe(`delete from time_slots where id=$1::uuid and hotel_id=$2`, id, hotelId);
    return { ok: true, data: { ok: true } };
  } catch (e) { return { ok: false, error: e instanceof Error ? e.message : "failed" }; }
}