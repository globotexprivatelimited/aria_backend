import { prisma } from "../db";

/**
 * A message WhatsApp refused because the guest's 24-hour window was closed is not lost: it waits here and goes
 * the moment the guest writes again. One re-engagement template per guest per day asks them to.
 */
const WEEK = 7 * 24 * 60 * 60 * 1000;

export async function enqueuePending(hotelId: string, guestPhone: string, body: string, reason: string): Promise<void> {
  if (!body.trim()) return;
  const dup = await prisma.$queryRawUnsafe<any[]>("select id from pending_messages where hotel_id=$1 and guest_phone=$2 and body=$3 and sent_at is null limit 1", hotelId, guestPhone, body);
  if (dup.length) return;
  await prisma.$executeRawUnsafe("insert into pending_messages (hotel_id, guest_phone, body, reason) values ($1,$2,$3,$4)", hotelId, guestPhone, body, reason.slice(0, 200));
}

export async function takePending(hotelId: string, guestPhone: string): Promise<{ id: string; body: string }[]> {
  const rows = await prisma.$queryRawUnsafe<any[]>("select id, body from pending_messages where hotel_id=$1 and guest_phone=$2 and sent_at is null and created_at > $3 order by created_at asc limit 10", hotelId, guestPhone, new Date(Date.now() - WEEK));
  return rows.map((r) => ({ id: String(r.id), body: String(r.body) }));
}

export async function markPendingSent(id: string): Promise<void> {
  await prisma.$executeRawUnsafe("update pending_messages set sent_at = now() where id = $1::uuid", id);
}

export async function reengagedRecently(hotelId: string, guestPhone: string): Promise<boolean> {
  const rows = await prisma.$queryRawUnsafe<any[]>("select id from reengagements where hotel_id=$1 and guest_phone=$2 and sent_at > $3 limit 1", hotelId, guestPhone, new Date(Date.now() - 24 * 60 * 60 * 1000));
  return rows.length > 0;
}

export async function recordReengagement(hotelId: string, guestPhone: string, template: string): Promise<void> {
  await prisma.$executeRawUnsafe("insert into reengagements (hotel_id, guest_phone, template) values ($1,$2,$3)", hotelId, guestPhone, template);
}
