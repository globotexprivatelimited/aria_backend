import { prisma } from "../db";

export type DeptMode = "accept_decline" | "auto" | "maintenance";

// hotelId -> dept -> mode. Refreshed on write and every 30s.
const cache = new Map<string, Map<string, DeptMode>>();
let lastLoad = 0;

export async function loadDeptModes(hotelId: string): Promise<Map<string, DeptMode>> {
  const existing = cache.get(hotelId);
  if (existing && Date.now() - lastLoad < 30000) return existing;
  try {
    const rows = await prisma.$queryRawUnsafe<any[]>(
      `select dept, mode from dept_config where hotel_id = $1`, hotelId);
    const m = new Map<string, DeptMode>();
    for (const r of rows) m.set(r.dept, r.mode as DeptMode);
    cache.set(hotelId, m);
    lastLoad = Date.now();
    return m;
  } catch {
    return existing ?? new Map();
  }
}

/** Synchronous read - returns undefined if not cached yet, so callers fall back to defaults. */
export function cachedDeptMode(hotelId: string, dept: string): DeptMode | undefined {
  return cache.get(hotelId)?.get(dept);
}

export async function getDeptModes(hotelId: string): Promise<{ dept: string; mode: DeptMode }[]> {
  const rows = await prisma.$queryRawUnsafe<any[]>(
    `select dept, mode from dept_config where hotel_id = $1 order by dept`, hotelId);
  return rows.map((r) => ({ dept: r.dept, mode: r.mode as DeptMode }));
}

export async function setDeptMode(hotelId: string, dept: string, mode: DeptMode, changedBy = "staff"): Promise<{ ok: boolean; error?: string }> {
  if (!hotelId || !dept) return { ok: false, error: "hotelId and dept required" };
  if (!["accept_decline", "auto", "maintenance"].includes(mode)) return { ok: false, error: "invalid mode" };
  try {
    await prisma.$executeRawUnsafe(
      `insert into dept_config (hotel_id, dept, mode, updated_at, changed_by) values ($1,$2,$3, now(), $4)
       on conflict (hotel_id, dept) do update set mode = excluded.mode, updated_at = now(), changed_by = excluded.changed_by`,
      hotelId, dept, mode, String(changedBy ?? "staff").slice(0, 80));
    console.log("dept mode changed", JSON.stringify({ hotelId, dept, mode, changedBy }));
    // every change is kept, not only the latest
    await prisma.$executeRawUnsafe("insert into dept_config_history (hotel_id, dept, mode, changed_by) values ($1,$2,$3,$4)", hotelId, dept, mode, String(changedBy ?? "staff").slice(0, 80));
    lastLoad = 0; // force a refresh
    await loadDeptModes(hotelId);
    return { ok: true };
  } catch (e) { return { ok: false, error: e instanceof Error ? e.message : "failed" }; }
}
/** Every mode change ever made at this hotel, newest first. */
export async function getDeptModeHistory(hotelId: string, limit = 50): Promise<{ dept: string; mode: string; changedBy: string | null; changedAt: string }[]> {
  const rows = await prisma.$queryRawUnsafe<any[]>("select dept, mode, changed_by, changed_at from dept_config_history where hotel_id = $1 order by changed_at desc limit $2", hotelId, limit);
  return rows.map((r) => ({ dept: String(r.dept), mode: String(r.mode), changedBy: r.changed_by ?? null, changedAt: new Date(r.changed_at).toISOString() }));
}
