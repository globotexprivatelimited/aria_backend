import { prisma } from "../db";
type Result<T> = { ok: true; data: T } | { ok: false; error: string };
function norm(r: any) { return { ...r, price: r.price == null ? null : Number(r.price), stock: r.stock == null ? null : Number(r.stock), duration_min: r.duration_min == null ? null : Number(r.duration_min), sort_order: Number(r.sort_order), available: !!r.available }; }

export async function listDeptItems(hotelId: string, dept: string): Promise<Result<any[]>> {
  if (!hotelId || !dept) return { ok: false, error: "hotelId and dept required" };
  try {
    const rows = await prisma.$queryRawUnsafe<any[]>(`select * from dept_items where hotel_id=$1 and dept=$2 order by kind, sort_order, name`, hotelId, dept);
    return { ok: true, data: rows.map(norm) };
  } catch (e) { return { ok: false, error: e instanceof Error ? e.message : "Could not load." }; }
}

export async function createDeptItem(hotelId: string, dept: string, item: { kind?: string; name: string; description?: string; price?: number; stock?: number; unit?: string; duration_min?: number }): Promise<Result<any>> {
  if (!hotelId || !dept || !item?.name) return { ok: false, error: "name required" };
  try {
    const rows = await prisma.$queryRawUnsafe<any[]>(
      `insert into dept_items (hotel_id, dept, kind, name, description, price, stock, unit, duration_min) values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning *`,
      hotelId, dept, item.kind ?? 'service', item.name, item.description ?? null,
      item.price ?? null, item.stock ?? null, item.unit ?? null, item.duration_min ?? null);
    return { ok: true, data: norm(rows[0]) };
  } catch (e) { return { ok: false, error: e instanceof Error ? e.message : "Could not create." }; }
}

export async function updateDeptItem(hotelId: string, id: string, fields: { name?: string; description?: string; price?: number; stock?: number; unit?: string; duration_min?: number; available?: boolean }): Promise<Result<any>> {
  if (!hotelId || !id) return { ok: false, error: "id required" };
  try {
    const rows = await prisma.$queryRawUnsafe<any[]>(
      `update dept_items set
         name=coalesce($3,name), description=coalesce($4,description), price=coalesce($5,price),
         stock=coalesce($6,stock), unit=coalesce($7,unit), duration_min=coalesce($8,duration_min),
         available=coalesce($9,available)
       where hotel_id=$1 and id=$2::uuid returning *`,
      hotelId, id, fields.name ?? null, fields.description ?? null, fields.price ?? null,
      fields.stock ?? null, fields.unit ?? null, fields.duration_min ?? null,
      fields.available === undefined ? null : fields.available);
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