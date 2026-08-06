import { prisma } from "../db";
type Result<T> = { ok: true; data: T } | { ok: false; error: string };
function norm(r: any) { return { ...r, category: r.category ?? null, urgency: r.urgency ?? null, time_from: r.time_from ?? null, time_to: r.time_to ?? null, seats: r.seats == null ? null : Number(r.seats), diet: r.diet ?? null, spice: r.spice ?? null, allergens: r.allergens ?? null, is_signature: !!r.is_signature, prep_mins: r.prep_mins == null ? null : Number(r.prep_mins), price: r.price == null ? null : Number(r.price), stock: r.stock == null ? null : Number(r.stock), duration_min: r.duration_min == null ? null : Number(r.duration_min), sort_order: Number(r.sort_order), available: !!r.available }; }

export async function listDeptItems(hotelId: string, dept: string): Promise<Result<any[]>> {
  if (!hotelId || !dept) return { ok: false, error: "hotelId and dept required" };
  try {
    const rows = await prisma.$queryRawUnsafe<any[]>(`select * from dept_items where hotel_id=$1 and dept=$2 order by kind, sort_order, name`, hotelId, dept);
    return { ok: true, data: rows.map(norm) };
  } catch (e) { return { ok: false, error: e instanceof Error ? e.message : "Could not load." }; }
}

export async function createDeptItem(hotelId: string, dept: string, item: { kind?: string; name: string; description?: string; price?: number; stock?: number; unit?: string; duration_min?: number; category?: string; urgency?: string; time_from?: string; time_to?: string; seats?: number; diet?: string; spice?: string; allergens?: string; is_signature?: boolean; prep_mins?: number }): Promise<Result<any>> {
  if (!hotelId || !dept || !item?.name) return { ok: false, error: "name required" };
  try {
    const rows = await prisma.$queryRawUnsafe<any[]>(
      `insert into dept_items (hotel_id, dept, kind, name, description, price, stock, unit, duration_min, category, urgency, time_from, time_to, seats, diet, spice, allergens, is_signature, prep_mins) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19) returning *`,
      hotelId, dept, item.kind ?? 'service', item.name, item.description ?? null,
      item.price ?? null, item.stock ?? null, item.unit ?? null, item.duration_min ?? null,
      item.category ?? null, item.urgency ?? null, item.time_from ?? null, item.time_to ?? null, item.seats ?? null, item.diet ?? null, item.spice ?? null, item.allergens ?? null, item.is_signature ?? false, item.prep_mins ?? null);
    return { ok: true, data: norm(rows[0]) };
  } catch (e) { return { ok: false, error: e instanceof Error ? e.message : "Could not create." }; }
}

export async function updateDeptItem(hotelId: string, id: string, fields: { name?: string; description?: string; price?: number; stock?: number; unit?: string; duration_min?: number; available?: boolean; category?: string; urgency?: string; time_from?: string; time_to?: string; seats?: number; diet?: string; spice?: string; allergens?: string; is_signature?: boolean; prep_mins?: number }): Promise<Result<any>> {
  if (!hotelId || !id) return { ok: false, error: "id required" };
  try {
    const rows = await prisma.$queryRawUnsafe<any[]>(
      `update dept_items set
         name=coalesce($3,name), description=coalesce($4,description), price=coalesce($5,price),
         stock=coalesce($6,stock), unit=coalesce($7,unit), duration_min=coalesce($8,duration_min),
         available=coalesce($9,available), category=coalesce($10,category), urgency=coalesce($11,urgency), time_from=coalesce($12,time_from), time_to=coalesce($13,time_to), seats=coalesce($14,seats), diet=coalesce($15,diet), spice=coalesce($16,spice), allergens=coalesce($17,allergens), is_signature=coalesce($18,is_signature), prep_mins=coalesce($19,prep_mins)
       where hotel_id=$1 and id=$2::uuid returning *`,
      hotelId, id, fields.name ?? null, fields.description ?? null, fields.price ?? null,
      fields.stock ?? null, fields.unit ?? null, fields.duration_min ?? null,
      fields.available === undefined ? null : fields.available, fields.category ?? null, fields.urgency ?? null, fields.time_from ?? null, fields.time_to ?? null, fields.seats ?? null, fields.diet ?? null, fields.spice ?? null, fields.allergens ?? null, fields.is_signature === undefined ? null : fields.is_signature, fields.prep_mins ?? null);
    if (!rows[0]) return { ok: false, error: "Item not found." };
    return { ok: true, data: norm(rows[0]) };
  } catch (e) { return { ok: false, error: e instanceof Error ? e.message : "Could not update." }; }
}

export async function deleteDeptItem(hotelId: string, id: string): Promise<Result<{ deleted: boolean }>> {
  if (!hotelId || !id) return { ok: false, error: "id required" };
  try {
    await prisma.$executeRawUnsafe(`delete from dept_items where hotel_id=$1 and id=$2::uuid`, hotelId, id);
    return { ok: true, data: { deleted: true } };
  } catch (e) { return { ok: false, error: e instanceof Error ? e.message : "Could not delete." }; }
}