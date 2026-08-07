import { prisma } from "../db";
type Result<T> = { ok: true; data: T } | { ok: false; error: string };

/**
 * Estimate what a missed request was worth, using the hotel's own prices.
 * We never invent a number without saying where it came from.
 */
async function estimateValue(hotelId: string, dept: string): Promise<{ value: number | null; basis: string }> {
  try {
    // 1. try the department's own items (dept_items covers spa, housekeeping, dining, maintenance)
    const di = await prisma.$queryRawUnsafe<any[]>(
      `select price from dept_items where hotel_id=$1 and dept=$2 and price is not null and price > 0`, hotelId, dept);
    if (di.length) {
      const prices = di.map((r) => Number(r.price)).sort((a, b) => a - b);
      const median = prices[Math.floor(prices.length / 2)];
      return { value: median, basis: "median of " + prices.length + " priced items in this department" };
    }
    // 2. for dining, the food menu is the better comparable
    const mi = await prisma.$queryRawUnsafe<any[]>(
      `select price from menu_items where hotel_id=$1 and dept=$2 and price is not null and price > 0`, hotelId, dept);
    if (mi.length) {
      const prices = mi.map((r) => Number(r.price)).sort((a, b) => a - b);
      const median = prices[Math.floor(prices.length / 2)];
      return { value: median, basis: "median of " + prices.length + " menu items in this department" };
    }
    // 3. nothing comparable - be honest rather than guess
    return { value: null, basis: "no priced items in this department yet" };
  } catch {
    return { value: null, basis: "could not estimate" };
  }
}

export async function recordMissedDemand(input: {
  hotelId: string; requestId?: string | null; roomNumber?: string | null; guestPhone?: string | null;
  department: string; requestedItem: string; source: "staff_declined" | "not_offered"; declineReason?: string | null;
}): Promise<void> {
  try {
    const { value, basis } = await estimateValue(input.hotelId, input.department);
    await prisma.$executeRawUnsafe(
      `insert into missed_demand (hotel_id, request_id, room_number, guest_phone, department, requested_item, source, decline_reason, estimated_value, estimate_basis)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      input.hotelId, input.requestId ?? null, input.roomNumber ?? null, input.guestPhone ?? null,
      input.department, input.requestedItem, input.source, input.declineReason ?? null, value, basis);
  } catch { /* never block a guest reply on analytics */ }
}

export type MissedGroup = {
  item: string; department: string; timesAsked: number;
  estimatedLoss: number | null; estimateBasis: string | null;
  instances: { room: string | null; when: string; detail: string; source: string; reason: string | null; value: number | null }[];
};

export async function getMissedDemand(hotelId: string, days = 30): Promise<Result<{
  groups: MissedGroup[]; totalLoss: number; totalMissed: number; unpriced: number;
}>> {
  if (!hotelId) return { ok: false, error: "hotelId required" };
  try {
    const rows = await prisma.$queryRawUnsafe<any[]>(
      `select room_number, department, requested_item, source, decline_reason, estimated_value, estimate_basis, created_at
         from missed_demand
        where hotel_id=$1 and resolved_by_hotel = false and created_at > now() - ($2 || ' days')::interval
        order by created_at desc limit 400`, hotelId, String(days));

    // group by what was asked for, so the GM sees patterns not noise
    const map = new Map<string, MissedGroup>();
    for (const r of rows) {
      const key = (r.department ?? "") + "::" + String(r.requested_item ?? "").toLowerCase().trim().slice(0, 60);
      const g = map.get(key) ?? {
        item: r.requested_item, department: r.department, timesAsked: 0,
        estimatedLoss: null, estimateBasis: r.estimate_basis ?? null, instances: [],
      };
      g.timesAsked += 1;
      const v = r.estimated_value == null ? null : Number(r.estimated_value);
      if (v != null) g.estimatedLoss = (g.estimatedLoss ?? 0) + v;
      g.instances.push({
        room: r.room_number ?? null,
        when: new Date(r.created_at).toISOString(),
        detail: r.requested_item,
        source: r.source,
        reason: r.decline_reason ?? null,
        value: v,
      });
      map.set(key, g);
    }
    const groups = Array.from(map.values()).sort((a, b) => b.timesAsked - a.timesAsked || (b.estimatedLoss ?? 0) - (a.estimatedLoss ?? 0));
    const totalLoss = groups.reduce((s, g) => s + (g.estimatedLoss ?? 0), 0);
    const unpriced = rows.filter((r) => r.estimated_value == null).length;
    return { ok: true, data: { groups, totalLoss, totalMissed: rows.length, unpriced } };
  } catch (e) { return { ok: false, error: e instanceof Error ? e.message : "failed" }; }
}

/** GM has added the item - stop counting it as a loss. */
export async function markAddressed(hotelId: string, department: string, item: string): Promise<Result<{ updated: number }>> {
  try {
    const n = await prisma.$executeRawUnsafe(
      `update missed_demand set resolved_by_hotel = true where hotel_id=$1 and department=$2 and lower(requested_item) = lower($3)`,
      hotelId, department, item);
    return { ok: true, data: { updated: Number(n) } };
  } catch (e) { return { ok: false, error: e instanceof Error ? e.message : "failed" }; }
}
