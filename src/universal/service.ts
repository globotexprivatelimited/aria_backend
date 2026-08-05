import { prisma } from "../db";
import { log } from "../lib/logger";
import { checkInGuest, checkOutGuest } from "../lib/frontdesk";
import { CanonicalCheckin, CanonicalCheckout, CanonicalUpdate } from "./contract";
import { adapterFor } from "./adapters";

/** Normalise any adapter payload, validate, then run the same check-in the form uses. */
export async function universalCheckin(hotelId: string, rawBody: Record<string, unknown>, adapterName?: string) {
  const mapped = adapterFor(adapterName)(hotelId, rawBody);
  const parsed = CanonicalCheckin.safeParse(mapped);
  if (!parsed.success) {
    return { ok: false, error: "invalid_payload", detail: parsed.error.issues.map((i) => i.path.join(".") + ": " + i.message) };
  }

  const d = parsed.data;
  const checkoutDate = d.checkoutAt ? new Date(d.checkoutAt) : undefined;
  const session = await checkInGuest(d.hotelId, d.room, d.guestName, d.phone, checkoutDate);

  log.info("universal: checkin", { source: d.source, room: d.room, phone: d.phone });
  return { ok: true, sessionId: session.id, room: session.roomNumber, verified: session.roomVerified };
}

export async function universalCheckout(hotelId: string, rawBody: Record<string, unknown>) {
  const parsed = CanonicalCheckout.safeParse({ ...rawBody, hotelId });
  if (!parsed.success) {
    return { ok: false, error: "invalid_payload", detail: parsed.error.issues.map((i) => i.message) };
  }

  const d = parsed.data;
  let room = d.room;
  if (!room && d.phone) {
    const s = await prisma.session.findFirst({
      where: { hotelId, guestPhone: d.phone, state: "active" },
      orderBy: { createdAt: "desc" },
    });
    room = s?.roomNumber ?? undefined;
  }
  if (!room) return { ok: false, error: "not_found", detail: "no active guest for that room or phone" };

  const closed = await checkOutGuest(hotelId, room);
  log.info("universal: checkout", { source: d.source, room });
  return { ok: Boolean(closed), closed: Boolean(closed), room };
}

export async function universalUpdate(hotelId: string, rawBody: Record<string, unknown>) {
  const parsed = CanonicalUpdate.safeParse({ ...rawBody, hotelId });
  if (!parsed.success) {
    return { ok: false, error: "invalid_payload", detail: parsed.error.issues.map((i) => i.message) };
  }

  const d = parsed.data;
  const session = await prisma.session.findFirst({
    where: { hotelId, roomNumber: d.room, state: "active" },
    orderBy: { createdAt: "desc" },
  });
  if (!session) return { ok: false, error: "not_found", detail: "no active guest in room " + d.room };

  const data: Record<string, unknown> = {};
  if (d.newRoom) data.roomNumber = d.newRoom;
  if (d.newCheckoutAt) data.checkOutDate = new Date(d.newCheckoutAt);

  const updated = await prisma.session.update({ where: { id: session.id }, data });
  log.info("universal: update", { source: d.source, room: d.room, newRoom: d.newRoom, newCheckout: d.newCheckoutAt });
  return { ok: true, sessionId: updated.id, room: updated.roomNumber, checkoutAt: updated.checkOutDate };
}

/** Bulk import for Excel hotels: an array of CSV-style rows at onboarding. */
export async function universalBulkImport(hotelId: string, rows: Record<string, unknown>[]) {
  let created = 0;
  const errors: string[] = [];
  for (const row of rows) {
    const res = await universalCheckin(hotelId, row, "csv");
    if (res.ok) created += 1;
    else errors.push(JSON.stringify(res.detail));
  }
  log.info("universal: bulk import", { hotelId, created, failed: errors.length });
  return { ok: true, created, failed: errors.length, errors: errors.slice(0, 10) };
}
