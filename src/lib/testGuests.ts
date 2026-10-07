import { prisma } from "../db";
import { log } from "./logger";

/**
 * The team's harness checks guests in under names like "Harness 3"; some test phones are fixed. Those are recorded
 * here at check-in, and revenue queries leave them out, so a live hotel's numbers are the hotel's own.
 */
const list = (v: string | undefined): string[] => (v ?? "").split(",").map((s) => s.trim()).filter(Boolean);

export function isTestGuest(name: string | null | undefined, phone: string | null | undefined): string | null {
  const n = (name ?? "").trim(); const p = (phone ?? "").replace(/[^0-9+]/g, "");
  if (/^(harness|test[\s_-]?guest|qa[\s_-]?guest|load[\s_-]?test)\b/i.test(n)) return "name: " + n;
  if (p && list(process.env.TEST_PHONES).some((t) => t.replace(/[^0-9+]/g, "") === p)) return "TEST_PHONES";
  if (p && list(process.env.TEST_PHONE_PREFIXES).some((t) => p.startsWith(t.replace(/[^0-9+]/g, "")))) return "TEST_PHONE_PREFIXES";
  return null;
}

export async function markTestGuest(hotelId: string, phone: string, name: string | null | undefined): Promise<boolean> {
  const reason = isTestGuest(name, phone);
  if (!reason || !phone) return false;
  try {
    await prisma.$executeRawUnsafe("insert into test_guests (hotel_id, phone, name, reason) values ($1,$2,$3,$4) on conflict (hotel_id, phone) do update set name = excluded.name, reason = excluded.reason", hotelId, phone, name ?? null, reason);
    log.info("test guest recorded - excluded from revenue", { hotelId, phone, reason });
    return true;
  } catch (e) { log.warn("test guest not recorded", { detail: e instanceof Error ? e.message : String(e) }); return false; }
}
