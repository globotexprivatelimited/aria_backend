import { prisma } from "../db";
import { log } from "../lib/logger";
import { sendReply, notifyDepartment } from "../lib/notify";

/**
 * Cancelling an order for real: the order row is marked cancelled, counted stock goes back, the board row is
 * closed as CANCELLED and the kitchen is told - or, if the kitchen has already claimed it, nothing is touched
 * and the caller is told so, because a promise the kitchen cannot keep is worse than none.
 */
export type CancelResult =
  | { outcome: "cancelled"; orderId: string; items: string; total: number; room: string | null }
  | { outcome: "started"; orderId: string; items: string }
  | { outcome: "none" };

const ORDER_SELECT =
  "select o.id, o.room, o.status, o.total, coalesce(string_agg(oi.qty || ' x ' || oi.name, ', ' order by oi.name), '') as items from orders o left join order_items oi on oi.order_id = o.id";

/** The kitchen has claimed or started it when its board row says so. */
async function kitchenStarted(hotelId: string, orderId: string): Promise<boolean> {
  const row = await prisma.request.findFirst({
    where: { hotelId, requestDetail: { contains: "order " + orderId.slice(0, 8) }, OR: [{ status: "in_progress" }, { claimedBy: { not: null } }] },
    select: { id: true },
  });
  return !!row;
}

/** Cancel one order by id (a full id or the 8-character prefix the boards show). */
export async function cancelOrder(hotelId: string, orderId: string, opts: { quiet?: boolean } = {}): Promise<CancelResult> {
  const rows = await prisma.$queryRawUnsafe<any[]>(ORDER_SELECT + " where o.hotel_id = $1 and o.id::text like ($2 || '%') group by o.id limit 1", hotelId, orderId.trim().toLowerCase());
  const o = rows[0];
  if (!o || o.status !== "placed") return { outcome: "none" };
  const id = String(o.id);
  if (await kitchenStarted(hotelId, id)) return { outcome: "started", orderId: id, items: String(o.items) };
  const changed = await prisma.$executeRawUnsafe("update orders set status = 'cancelled' where id = $1::uuid and status = 'placed'", id);
  if (Number(changed) === 0) return { outcome: "none" };
  // counted stock goes back on the shelf; items that are not counted (stock 0) stay as they are
  await prisma.$executeRawUnsafe("update menu_items m set stock = m.stock + oi.qty from order_items oi where oi.order_id = $1::uuid and oi.menu_item_id = m.id and m.stock > 0", id);
  await prisma.$executeRawUnsafe(
    "update \"Request\" set \"requestDetail\" = 'CANCELLED - ' || \"requestDetail\", status = 'resolved', \"resolvedAt\" = now() where \"hotelId\" = $1 and \"requestDetail\" like $2 and status <> 'resolved'",
    hotelId, "%order " + id.slice(0, 8) + "%"
  );
  if (!opts.quiet) await notifyDepartment(hotelId, "fb", "CANCELLED - Room " + (o.room ?? "?") + ": " + String(o.items) + " (order " + id.slice(0, 8) + ") - do not prepare");
  log.info("order cancelled", { hotelId, orderId: id, items: o.items });
  return { outcome: "cancelled", orderId: id, items: String(o.items), total: Number(o.total), room: o.room ?? null };
}

/** The guest's most recent open order, if it is recent enough to still be stoppable. */
export async function cancelLatestOrder(hotelId: string, guestPhone: string, withinMinutes = 90): Promise<CancelResult> {
  const rows = await prisma.$queryRawUnsafe<any[]>(
    "select o.id from orders o where o.hotel_id = $1 and o.guest_phone = $2 and o.status = 'placed' and o.created_at > now() - make_interval(mins => $3::int) order by o.created_at desc limit 1",
    hotelId, guestPhone, withinMinutes
  );
  if (!rows[0]) return { outcome: "none" };
  return cancelOrder(hotelId, String(rows[0].id));
}

/** Does a filed request describe the guest cancelling or cutting down an order they just placed? */
export function looksLikeOrderCancellation(detail: string): boolean {
  const d = (detail ?? "").toLowerCase();
  const wants = /\b(cancel|cancle|remove|undo|reduce|duplicate|twice|double|only (?:one|1)|not (?:two|2)|(?:don'?t|doesn'?t|does not|do not|no longer) (?:want|need))\b/.test(d);
  const order = /\b(order|ordered|plate|plates|food|dish|meal|item|items|room service)\b/.test(d);
  return wants && order;
}

/** For the form-filling brain: do the cancellation and tell the guest what actually happened, in a second message. */
export async function cancelAndTell(hotelId: string, guestPhone: string): Promise<CancelResult> {
  const r = await cancelLatestOrder(hotelId, guestPhone);
  if (r.outcome === "cancelled") {
    await sendReply(guestPhone, "Done - I have cancelled the order for " + r.items + " (\u20B9" + r.total + ") and told the kitchen. If you would still like some of it, just say and I will place a fresh order.", hotelId);
  } else if (r.outcome === "started") {
    await sendReply(guestPhone, "The kitchen has already started on " + r.items + ", so I cannot stop it myself - I have asked the team to sort it out with you.", hotelId);
  }
  return r;
}
