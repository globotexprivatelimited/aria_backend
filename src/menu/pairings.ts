import { prisma } from "../db";

/**
 * Knowledge base Form 3: what a menu item goes well with (up to two items), what must never be suggested,
 * and what it contains (allergies). Kept beside the menu, read by the brain on every message.
 */
export type Pairing = { itemId: string; itemName: string; pairsWith: string[]; neverSuggest: boolean; contains: string | null; updatedAt: string; updatedBy: string | null };
export type PairingInput = { itemId: string; itemName: string; pairsWith?: string[] | string | null; neverSuggest?: boolean; contains?: string | null };

const splitList = (v: unknown): string[] => (Array.isArray(v) ? v : String(v ?? "").split(/[,;|]/)).map((s) => String(s).trim()).filter(Boolean).slice(0, 2);
function norm(r: any): Pairing {
  return { itemId: String(r.item_id), itemName: String(r.item_name), pairsWith: splitList(r.pairs_with), neverSuggest: r.never_suggest === true, contains: r.contains ?? null, updatedAt: r.updated_at ? new Date(r.updated_at).toISOString() : "", updatedBy: r.updated_by ?? null };
}

export async function listPairings(hotelId: string): Promise<Pairing[]> {
  const rows = await prisma.$queryRawUnsafe<any[]>("select * from menu_pairings where hotel_id = $1 order by item_name", hotelId);
  return rows.map(norm);
}

export async function setPairing(hotelId: string, p: PairingInput, by?: string): Promise<Pairing> {
  const pairs = splitList(p.pairsWith).join(", ") || null;
  const rows = await prisma.$queryRawUnsafe<any[]>(
    "insert into menu_pairings (hotel_id, item_id, item_name, pairs_with, never_suggest, contains, updated_by) values ($1,$2,$3,$4,$5,$6,$7) on conflict (hotel_id, item_id) do update set item_name = excluded.item_name, pairs_with = excluded.pairs_with, never_suggest = excluded.never_suggest, contains = excluded.contains, updated_at = now(), updated_by = excluded.updated_by returning *",
    hotelId, String(p.itemId), String(p.itemName).trim(), pairs, p.neverSuggest === true, (p.contains ?? "").toString().trim() || null, by || null);
  return norm(rows[0]);
}

export async function deletePairing(hotelId: string, itemId: string): Promise<boolean> {
  const n = await prisma.$executeRawUnsafe("delete from menu_pairings where hotel_id = $1 and item_id = $2", hotelId, itemId);
  return Number(n) > 0;
}

/** The block the brain reads. Empty when nothing is recorded. */
export function renderPairings(list: Pairing[]): string {
  const goes = list.filter((p) => p.pairsWith.length).map((p) => "- " + p.itemName + " goes well with: " + p.pairsWith.join(", "));
  const never = list.filter((p) => p.neverSuggest).map((p) => p.itemName);
  const contains = list.filter((p) => p.contains).map((p) => p.itemName + " - " + p.contains);
  if (!goes.length && !never.length && !contains.length) return "";
  const out = ["MENU PAIRINGS (the hotel's own: suggest at most one pairing, only when it fits what the guest ordered, never for anything sold out or closed):"];
  out.push(...goes);
  if (never.length) out.push("- Never suggest unless the guest asks for it by name: " + never.join(", "));
  if (contains.length) out.push("- Contains (say so if a guest mentions an allergy or asks): " + contains.join("; "));
  return out.join("\n");
}

export async function pairingsForPrompt(hotelId: string): Promise<string> {
  try { return renderPairings(await listPairings(hotelId)); } catch { return ""; }
}
