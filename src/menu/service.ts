import { prisma } from "../db";

type Result<T> = { ok: true; data: T } | { ok: false; error: string };

export type MenuItemInput = {
  name: string; category?: string | null; kind?: string; price?: number; stock?: number;
  diet?: string; spice?: string; prep_mins?: number; available_from?: string | null; available_to?: string | null;
  low_stock_at?: number; image_url?: string | null; description?: string | null; allergens?: string | null;
  serving_size?: string | null; calories?: number | null; portion?: string; tax_pct?: number;
  is_jain?: boolean; is_halal?: boolean; gluten_free?: boolean; is_alcoholic?: boolean; age_restricted?: boolean;
  is_signature?: boolean; is_bestseller?: boolean; available?: boolean; sort_order?: number;
};

// numeric/bigint columns come back as strings/BigInt from raw SQL - normalise for JSON
function norm(row: any) {
  if (!row) return row;
  return {
    ...row,
    price: row.price != null ? Number(row.price) : 0,
    tax_pct: row.tax_pct != null ? Number(row.tax_pct) : 0,
    stock: row.stock != null ? Number(row.stock) : 0,
    prep_mins: row.prep_mins != null ? Number(row.prep_mins) : 0,
    low_stock_at: row.low_stock_at != null ? Number(row.low_stock_at) : 3,
    calories: row.calories != null ? Number(row.calories) : null,
    sort_order: row.sort_order != null ? Number(row.sort_order) : 0,
  };
}

export async function listMenu(hotelId: string, dept?: string): Promise<Result<any[]>> {
  try {
    const rows = dept
      ? await prisma.$queryRawUnsafe<any[]>(`select * from menu_items where hotel_id = $1 and dept = $2 order by category asc nulls last, sort_order asc, created_at asc`, hotelId, dept)
      : await prisma.$queryRawUnsafe<any[]>(`select * from menu_items where hotel_id = $1 order by category asc nulls last, sort_order asc, created_at asc`, hotelId);
    return { ok: true, data: rows.map(norm) };
  } catch (e) { return { ok: false, error: e instanceof Error ? e.message : "Could not load menu." }; }
}

export async function createMenuItem(hotelId: string, dept: string, i: MenuItemInput): Promise<Result<any>> {
  if (!i?.name?.trim()) return { ok: false, error: "Item name is required." };
  const isAlc = i.kind === "alcohol";
  try {
    const rows = await prisma.$queryRawUnsafe<any[]>(
      `insert into menu_items
        (hotel_id, dept, name, category, kind, price, stock, available, sort_order, diet, spice, prep_mins,
         available_from, available_to, low_stock_at, image_url, description, allergens, serving_size, calories,
         portion, tax_pct, is_jain, is_halal, gluten_free, is_alcoholic, age_restricted, is_signature, is_bestseller)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29)
       returning *`,
      hotelId, dept, i.name.trim(), i.category?.trim() || null, i.kind ?? "food", i.price ?? 0, i.stock ?? 0,
      i.available ?? true, i.sort_order ?? 0, i.diet ?? "veg", i.spice ?? "none", i.prep_mins ?? 0,
      i.available_from ?? null, i.available_to ?? null, i.low_stock_at ?? 3, i.image_url ?? null, i.description ?? null,
      i.allergens ?? null, i.serving_size ?? null, i.calories ?? null, i.portion ?? "single", i.tax_pct ?? 0,
      i.is_jain ?? false, i.is_halal ?? false, i.gluten_free ?? false, isAlc || (i.is_alcoholic ?? false),
      isAlc || (i.age_restricted ?? false), i.is_signature ?? false, i.is_bestseller ?? false
    );
    return { ok: true, data: norm(rows[0]) };
  } catch (e) { return { ok: false, error: e instanceof Error ? e.message : "Could not add item." }; }
}

// update: whitelist columns, build a dynamic SET, tenant-guard on hotel_id
const UPDATABLE = new Set([
  "name","category","kind","price","stock","available","sort_order","diet","spice","prep_mins",
  "available_from","available_to","low_stock_at","image_url","description","allergens","serving_size",
  "calories","portion","tax_pct","is_jain","is_halal","gluten_free","is_alcoholic","age_restricted",
  "is_signature","is_bestseller",
]);
export async function updateMenuItem(hotelId: string, id: string, fields: Record<string, any>): Promise<Result<any>> {
  if (!id) return { ok: false, error: "Item id required." };
  const keys = Object.keys(fields).filter((k) => UPDATABLE.has(k));
  if (keys.length === 0) return { ok: false, error: "No valid fields to update." };
  try {
    const sets = keys.map((k, idx) => `"${k}" = $${idx + 3}`).join(", ");
    const vals = keys.map((k) => fields[k]);
    const rows = await prisma.$queryRawUnsafe<any[]>(
      `update menu_items set ${sets} where id = $1::uuid and hotel_id = $2 returning *`,
      id, hotelId, ...vals
    );
    if (!rows[0]) return { ok: false, error: "Item not found for this hotel." };
    return { ok: true, data: norm(rows[0]) };
  } catch (e) { return { ok: false, error: e instanceof Error ? e.message : "Could not update item." }; }
}

export async function deleteMenuItem(hotelId: string, id: string): Promise<Result<{ id: string }>> {
  if (!id) return { ok: false, error: "Item id required." };
  try {
    await prisma.$executeRawUnsafe(`delete from menu_items where id = $1::uuid and hotel_id = $2`, id, hotelId);
    return { ok: true, data: { id } };
  } catch (e) { return { ok: false, error: e instanceof Error ? e.message : "Could not delete item." }; }
}

// place an order: atomic stock decrement via decrement_stock() then record order + items
export async function placeOrder(hotelId: string, dept: string, opts: { room?: string; guestPhone?: string; items: { menu_item_id: string; qty: number }[] }): Promise<Result<any>> {
  if (!opts?.items?.length) return { ok: false, error: "No items in the order." };
  try {
    const lines: { menu_item_id: string; name: string; unit_price: number; qty: number }[] = [];
    const lowStock: string[] = [];
    let total = 0;
    for (const line of opts.items) {
      const itemRows = await prisma.$queryRawUnsafe<any[]>(`select name, price from menu_items where id = $1::uuid and hotel_id = $2`, line.menu_item_id, hotelId);
      const item = itemRows[0];
      if (!item) return { ok: false, error: "Item not found: " + line.menu_item_id };
      const dec = await prisma.$queryRawUnsafe<any[]>(`select * from decrement_stock($1::uuid, $2::int)`, line.menu_item_id, line.qty);
      const res = dec[0];
      if (!res?.ok) return { ok: false, error: "Not enough stock for " + item.name };
      if (res.low) lowStock.push(item.name);
      const price = Number(item.price);
      total += price * line.qty;
      lines.push({ menu_item_id: line.menu_item_id, name: item.name, unit_price: price, qty: line.qty });
    }
    const orderRows = await prisma.$queryRawUnsafe<any[]>(
      `insert into orders (hotel_id, dept, room, guest_phone, status, total) values ($1,$2,$3,$4,'placed',$5) returning *`,
      hotelId, dept, opts.room ?? null, opts.guestPhone ?? null, total
    );
    const order = orderRows[0];
    for (const l of lines) {
      await prisma.$executeRawUnsafe(
        `insert into order_items (order_id, menu_item_id, name, unit_price, qty) values ($1::uuid, $2::uuid, $3, $4, $5)`,
        order.id, l.menu_item_id, l.name, l.unit_price, l.qty
      );
    }
    return { ok: true, data: { order: { ...order, total: Number(order.total) }, lowStock } };
  } catch (e) { return { ok: false, error: e instanceof Error ? e.message : "Could not place order." }; }
}