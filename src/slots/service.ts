import { prisma } from "../db";

type Result<T> = { ok: true; data: T } | { ok: false; error: string };

function norm(row: any) {
  if (!row) return row;
  return { ...row, capacity: row.capacity != null ? Number(row.capacity) : 1, sort_order: row.sort_order != null ? Number(row.sort_order) : 0 };
}

export async function listSlots(hotelId: string, dept?: string): Promise<Result<any[]>> {
  try {
    const rows = dept
      ? await prisma.$queryRawUnsafe<any[]>(`select * from time_slots where hotel_id = $1 and dept = $2 order by start_time asc`, hotelId, dept)
      : await prisma.$queryRawUnsafe<any[]>(`select * from time_slots where hotel_id = $1 order by start_time asc`, hotelId);
    return { ok: true, data: rows.map(norm) };
  } catch (e) { return { ok: false, error: e instanceof Error ? e.message : "Could not load slots." }; }
}

export async function createSlot(hotelId: string, dept: string, i: { label?: string; start_time: string; capacity?: number; sort_order?: number }): Promise<Result<any>> {
  if (!i?.start_time?.trim()) return { ok: false, error: "Start time is required." };
  try {
    const rows = await prisma.$queryRawUnsafe<any[]>(
      `insert into time_slots (hotel_id, dept, label, start_time, capacity, active, sort_order)
       values ($1,$2,$3,$4,$5,true,$6) returning *`,
      hotelId, dept, i.label?.trim() || i.start_time.trim(), i.start_time.trim(), i.capacity ?? 1, i.sort_order ?? 0
    );
    return { ok: true, data: norm(rows[0]) };
  } catch (e) { return { ok: false, error: e instanceof Error ? e.message : "Could not add slot." }; }
}

const UPDATABLE = new Set(["label", "start_time", "capacity", "active", "sort_order"]);
export async function updateSlot(hotelId: string, id: string, fields: Record<string, any>): Promise<Result<any>> {
  if (!id) return { ok: false, error: "Slot id required." };
  const keys = Object.keys(fields).filter((k) => UPDATABLE.has(k));
  if (keys.length === 0) return { ok: false, error: "No valid fields to update." };
  try {
    const sets = keys.map((k, idx) => `"${k}" = $${idx + 3}`).join(", ");
    const vals = keys.map((k) => fields[k]);
    const rows = await prisma.$queryRawUnsafe<any[]>(
      `update time_slots set ${sets} where id = $1::uuid and hotel_id = $2 returning *`, id, hotelId, ...vals
    );
    if (!rows[0]) return { ok: false, error: "Slot not found for this hotel." };
    return { ok: true, data: norm(rows[0]) };
  } catch (e) { return { ok: false, error: e instanceof Error ? e.message : "Could not update slot." }; }
}

export async function deleteSlot(hotelId: string, id: string): Promise<Result<{ id: string }>> {
  if (!id) return { ok: false, error: "Slot id required." };
  try {
    await prisma.$executeRawUnsafe(`delete from time_slots where id = $1::uuid and hotel_id = $2`, id, hotelId);
    return { ok: true, data: { id } };
  } catch (e) { return { ok: false, error: e instanceof Error ? e.message : "Could not delete slot." }; }
}