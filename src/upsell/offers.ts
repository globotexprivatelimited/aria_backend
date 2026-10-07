import { prisma } from "../db";
import { log } from "../lib/logger";
import { isAvailableNow, picksFor, loadGuestHistory, type Catalog, type CatalogItem, type CatalogDept } from "../menu/catalog";
import { listPairings, type Pairing } from "../menu/pairings";
import { listFacilities, effectiveStatus, hotelToday, type Facility } from "../facilities/service";
import { offerLimits } from "../settings/service";

/**
 * Upselling the way the spec wants it: the code picks the item and the price - from the hotel's pairings and the
 * live menu, never for a closed facility, never something marked "never suggest", never more often than the
 * hotel allows - and the AI only writes the sentence. Every offer is logged: proposed to the AI, spoken to the
 * guest (or skipped), then accepted (with the revenue) or declined, which feeds the revenue-from-suggestions report.
 */
export type OfferStatus = "proposed" | "offered" | "skipped" | "accepted" | "declined";
export type OfferChoice = { item: CatalogItem; reason: string; basis: "pairing" | "moment" };
export type OfferRow = { id: string; guestPhone: string; itemName: string; dept: string; price: number; reason: string | null; basis: string | null; status: OfferStatus; proposedAt: string; offeredAt: string | null; resolvedAt: string | null; revenue: number };
export type OfferReport = { days: number; proposed: number; offered: number; accepted: number; declined: number; skipped: number; acceptanceRate: number; revenue: number; byItem: { itemName: string; offered: number; accepted: number; revenue: number }[]; recent: OfferRow[] };

const norm = (s: string): string => String(s ?? "").toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();
const STOP = new Set(["the", "and", "with", "of", "a", "an", "in", "on", "for", "to", "our", "your", "special", "fresh", "hot", "cold", "cup", "glass", "plate", "bowl"]);
const words = (s: string): string[] => norm(s).split(" ").filter((w) => w.length >= 3 && !STOP.has(w));
const money = (n: number): string => "Rs " + Math.round(n).toLocaleString("en-IN");

/** Does a text mention this item - the whole name, or enough of its distinctive words? */
export function mentions(text: string, itemName: string): boolean {
  const t = " " + norm(text) + " ", n = norm(itemName);
  if (!n) return false;
  if (t.includes(" " + n + " ")) return true;
  const ws = words(itemName);
  if (!ws.length) return false;
  const hits = ws.filter((w) => t.includes(" " + w + " ")).length;
  return ws.length === 1 ? hits === 1 : hits >= Math.min(2, ws.length);
}

/** "2 x Masala chai", "Masala chai x 2", "2 Masala chai" - how many of it; 1 when nothing says. */
export function qtyOf(text: string, itemName: string): number {
  const n = itemName.replace(/[.*+?^$(){}|[\]\\]/g, "\\$&");
  const m = new RegExp("(\\d+)\\s*(?:x|\\u00d7)?\\s*" + n, "i").exec(text) ?? new RegExp(n + "\\s*(?:x|\\u00d7)\\s*(\\d+)", "i").exec(text);
  const q = m ? Number(m[1]) : 1;
  return Number.isFinite(q) && q >= 1 && q <= 50 ? q : 1;
}

/** Which menu departments a closed facility silences: a closed spa means no spa offers; a closed restaurant or kitchen, no food. */
export function closedDepts(facilities: { name: string; status: string }[]): Set<string> {
  const out = new Set<string>();
  for (const f of facilities) {
    if (f.status !== "closed") continue;
    const n = f.name.toLowerCase();
    if (/spa|wellness|salon|massage/.test(n)) out.add("spa");
    if (/restaurant|dining|bar|cafe|lounge|rooftop/.test(n)) out.add("dining");
    if (/kitchen|room service|in-room/.test(n)) out.add("fb");
  }
  return out;
}

function findItem(catalog: Catalog, name: string): CatalogItem | null {
  const n = norm(name);
  if (!n) return null;
  return catalog.items.find((i) => norm(i.name) === n) ?? catalog.items.find((i) => norm(i.name).includes(n) || n.includes(norm(i.name))) ?? null;
}

/**
 * The code's choice. First a pairing for something the guest has just ordered ("goes well with"); failing that the
 * strongest pick for the moment - the time of day and the weather. Null when nothing fits, and then nothing is offered.
 */
export function chooseOffer(args: { catalog: Catalog; pairings: Pairing[]; recentNames: string[]; closed: Set<string>; history: Map<string, number>; exclude?: Set<string> }): OfferChoice | null {
  const { catalog, pairings, recentNames, closed, history } = args;
  const never = new Set(pairings.filter((p) => p.neverSuggest).map((p) => p.itemId));
  const neverNames = new Set(pairings.filter((p) => p.neverSuggest).map((p) => norm(p.itemName)));
  const had = new Set(recentNames.map(norm));
  const okItem = (i: CatalogItem): boolean => !closed.has(i.dept) && !never.has(i.id) && !neverNames.has(norm(i.name)) && !(args.exclude?.has(i.id)) && !had.has(norm(i.name)) && i.price > 0;
  for (const name of recentNames) {
    const base = findItem(catalog, name);
    const p = pairings.find((x) => (base && x.itemId === base.id) || norm(x.itemName) === norm(name));
    if (!p) continue;
    for (const partner of p.pairsWith) {
      const item = findItem(catalog, partner);
      if (item && okItem(item) && isAvailableNow(item, catalog.timezone)) return { item, reason: "goes well with the " + (base?.name ?? name) + " the guest ordered", basis: "pairing" };
    }
  }
  for (const dept of ["fb", "dining"] as CatalogDept[]) {
    if (closed.has(dept)) continue;
    const pick = picksFor(catalog, dept, history, { limit: 5, minScore: 2 }).find((p) => okItem(p.item));
    if (pick) return { item: pick.item, reason: pick.reason, basis: "moment" };
  }
  return null;
}

/** The sentence the AI is handed - the item and price are fixed; only the wording is its own. */
export function renderOffer(c: OfferChoice): string {
  return "UPSELL - chosen by the hotel's own rules (live availability, nothing closed, not offered recently): " + c.item.name + " at " + money(c.item.price) + (c.reason ? " - " + c.reason : "") + ". If it fits the conversation, mention it ONCE in one short sentence and never push. Do not mention it when the guest is complaining, has a problem, or is in distress. Offer nothing else unprompted. If the guest says yes, place it with place_order.";
}

async function recentOrderNames(hotelId: string, guestPhone: string, catalog: Catalog): Promise<string[]> {
  try {
    const rows = await prisma.$queryRawUnsafe<any[]>(
      "select oi.menu_item_id as id from order_items oi join orders o on o.id = oi.order_id where o.hotel_id = $1 and o.guest_phone = $2 and o.status <> 'cancelled' and o.created_at > now() - interval '4 hours' order by o.created_at desc limit 20", hotelId, guestPhone);
    const names: string[] = [];
    for (const r of rows) { const item = catalog.items.find((i) => i.id === String(r.id)); if (item && !names.includes(item.name)) names.push(item.name); }
    return names;
  } catch { return []; }
}

/**
 * Pick an offer for this turn and log it as proposed. Empty when the hotel's limits say not now, when one is already
 * on the table, or when nothing fits. In a dry run nothing is written.
 */
export async function offerForPrompt(hotelId: string, guestPhone: string, catalog: Catalog, opts: { dryRun?: boolean } = {}): Promise<string> {
  try {
    const limits = await offerLimits(hotelId);
    if (limits.perDay <= 0) return "";
    if (!opts.dryRun) await prisma.$executeRawUnsafe("update offers set status = 'declined', resolved_at = now() where hotel_id = $1 and status = 'offered' and offered_at < now() - interval '24 hours'", hotelId);
    const recent = await prisma.$queryRawUnsafe<any[]>("select item_id, status, proposed_at, offered_at from offers where hotel_id = $1 and guest_phone = $2 and proposed_at > now() - interval '24 hours' order by proposed_at desc", hotelId, guestPhone);
    const spoken = recent.filter((r) => r.status === "offered" || r.status === "accepted" || r.status === "declined");
    if (spoken.length >= limits.perDay) return "";
    const last = spoken[0];
    if (last && Date.now() - new Date(last.offered_at ?? last.proposed_at).getTime() < limits.gapHours * 3600 * 1000) return "";
    if (recent.some((r) => r.status === "proposed" && Date.now() - new Date(r.proposed_at).getTime() < 10 * 60 * 1000)) return "";
    const exclude = new Set<string>(recent.map((r) => String(r.item_id)));
    const [pairings, facilities, history, recentNames] = await Promise.all([listPairings(hotelId).catch(() => [] as Pairing[]), listFacilities(hotelId).catch(() => [] as Facility[]), loadGuestHistory(hotelId, guestPhone), recentOrderNames(hotelId, guestPhone, catalog)]);
    const { today } = hotelToday(catalog.timezone);
    const closed = closedDepts(facilities.filter((f) => f.active).map((f) => ({ name: f.name, status: effectiveStatus(f, today) })));
    const choice = chooseOffer({ catalog, pairings, recentNames, closed, history, exclude });
    if (!choice) return "";
    if (!opts.dryRun) await prisma.$executeRawUnsafe("insert into offers (hotel_id, guest_phone, item_id, item_name, dept, price, reason, basis, status) values ($1,$2,$3,$4,$5,$6,$7,$8,'proposed')", hotelId, guestPhone, choice.item.id, choice.item.name, choice.item.dept, choice.item.price, choice.reason || null, choice.basis);
    return "\n" + renderOffer(choice) + "\n";
  } catch (e) { log.warn("upsell: no offer this turn", { hotelId, detail: e instanceof Error ? e.message : String(e) }); return ""; }
}

/** After the reply went out: did the AI actually say it? Offered if the reply names the item, skipped if not. */
export async function offerSpoken(hotelId: string, guestPhone: string, reply: string): Promise<OfferStatus | null> {
  try {
    const rows = await prisma.$queryRawUnsafe<any[]>("select id, item_name from offers where hotel_id = $1 and guest_phone = $2 and status = 'proposed' and proposed_at > now() - interval '15 minutes' order by proposed_at desc limit 1", hotelId, guestPhone);
    if (!rows[0]) return null;
    const said = mentions(reply, String(rows[0].item_name));
    if (said) await prisma.$executeRawUnsafe("update offers set status = 'offered', offered_at = now() where id = $1::uuid", rows[0].id);
    else await prisma.$executeRawUnsafe("update offers set status = 'skipped', resolved_at = now() where id = $1::uuid", rows[0].id);
    log.info("upsell: " + (said ? "offered" : "skipped by the AI"), { hotelId, item: rows[0].item_name });
    return said ? "offered" : "skipped";
  } catch (e) { log.warn("upsell: could not record the reply", { detail: e instanceof Error ? e.message : String(e) }); return null; }
}

/** After an order is placed: an open offer for something in it is accepted, and the revenue is the price times the quantity. */
export async function offerAccepted(hotelId: string, guestPhone: string, orderText: string): Promise<number> {
  try {
    const rows = await prisma.$queryRawUnsafe<any[]>("select id, item_name, price from offers where hotel_id = $1 and guest_phone = $2 and status = 'offered' and offered_at > now() - interval '24 hours'", hotelId, guestPhone);
    let n = 0;
    for (const r of rows) {
      if (!mentions(orderText, String(r.item_name))) continue;
      const revenue = Number(r.price) * qtyOf(orderText, String(r.item_name));
      await prisma.$executeRawUnsafe("update offers set status = 'accepted', resolved_at = now(), revenue = $2, order_ref = $3 where id = $1::uuid", r.id, revenue, orderText.slice(0, 200));
      log.info("upsell: accepted", { hotelId, item: r.item_name, revenue });
      n++;
    }
    return n;
  } catch (e) { log.warn("upsell: could not record acceptance", { detail: e instanceof Error ? e.message : String(e) }); return 0; }
}

function normRow(r: any): OfferRow {
  const at = (v: unknown): string | null => (v ? new Date(v as string).toISOString() : null);
  return { id: String(r.id), guestPhone: String(r.guest_phone), itemName: String(r.item_name), dept: String(r.dept), price: Number(r.price), reason: r.reason ?? null, basis: r.basis ?? null, status: r.status as OfferStatus, proposedAt: at(r.proposed_at) ?? "", offeredAt: at(r.offered_at), resolvedAt: at(r.resolved_at), revenue: Number(r.revenue ?? 0) };
}

/** Revenue from suggestions - test guests left out. */
export async function offerReport(hotelId: string, days = 30): Promise<OfferReport> {
  const d = Math.max(1, Math.min(365, Math.round(Number(days) || 30)));
  const where = "hotel_id = $1 and proposed_at > now() - ($2::int * interval '1 day') and coalesce(guest_phone,'') not in (select phone from test_guests where hotel_id = $1)";
  await prisma.$executeRawUnsafe("update offers set status = 'declined', resolved_at = now() where hotel_id = $1 and status = 'offered' and offered_at < now() - interval '24 hours'", hotelId).catch(() => undefined);
  const [tot, items, recent] = await Promise.all([
    prisma.$queryRawUnsafe<any[]>("select count(*)::int as proposed, count(*) filter (where status in ('offered','accepted','declined'))::int as offered, count(*) filter (where status = 'accepted')::int as accepted, count(*) filter (where status = 'declined')::int as declined, count(*) filter (where status = 'skipped')::int as skipped, coalesce(sum(revenue) filter (where status = 'accepted'), 0) as revenue from offers where " + where, hotelId, d),
    prisma.$queryRawUnsafe<any[]>("select item_name, count(*) filter (where status in ('offered','accepted','declined'))::int as offered, count(*) filter (where status = 'accepted')::int as accepted, coalesce(sum(revenue) filter (where status = 'accepted'), 0) as revenue from offers where " + where + " group by item_name order by revenue desc, offered desc limit 20", hotelId, d),
    prisma.$queryRawUnsafe<any[]>("select * from offers where " + where + " and status <> 'proposed' order by proposed_at desc limit 40", hotelId, d),
  ]);
  const t = tot[0] ?? {};
  const offered = Number(t.offered ?? 0), accepted = Number(t.accepted ?? 0);
  return { days: d, proposed: Number(t.proposed ?? 0), offered, accepted, declined: Number(t.declined ?? 0), skipped: Number(t.skipped ?? 0), acceptanceRate: offered ? Math.round((accepted / offered) * 100) : 0, revenue: Number(t.revenue ?? 0), byItem: items.map((r) => ({ itemName: String(r.item_name), offered: Number(r.offered), accepted: Number(r.accepted), revenue: Number(r.revenue) })), recent: recent.map(normRow) };
}
