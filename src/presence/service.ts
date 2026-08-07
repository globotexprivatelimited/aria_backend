import { prisma } from "../db";
type Result<T> = { ok: true; data: T } | { ok: false; error: string };

// A staff member counts as online if seen within this window.
const ONLINE_WINDOW_SECONDS = 120;

export async function touchPresence(staffUserId: string): Promise<void> {
  try {
    await prisma.$executeRawUnsafe(`update staff_users set last_seen = now() where id::text = $1`, staffUserId);
  } catch { /* presence is best-effort */ }
}

export type DeptPresence = { dept: string; online: boolean; assignedCount: number; staff: { name: string; lastSeen: string | null }[] };
const ALL_DEPT_KEYS = ["fb", "housekeeping", "spa", "front_desk", "dining", "maintenance"];

export async function getDepartmentPresence(hotelId: string): Promise<Result<DeptPresence[]>> {
  if (!hotelId) return { ok: false, error: "hotelId required" };
  try {
    const rows = await prisma.$queryRawUnsafe<any[]>(
      `select sd.dept,
              su.full_name,
              su.last_seen,
              (su.last_seen is not null and su.last_seen > now() - interval '${ONLINE_WINDOW_SECONDS} seconds') as is_online
         from staff_departments sd
         join staff_users su on su.id = sd.staff_user_id
        where su.hotel_id = $1 and sd.active = true and su.is_active is not false
        order by sd.dept, su.full_name`, hotelId);

    // start with every department so the GM sees the ones with no staff at all
    const byDept = new Map<string, DeptPresence>();
    for (const k of ALL_DEPT_KEYS) byDept.set(k, { dept: k, online: false, assignedCount: 0, staff: [] } as DeptPresence);
    for (const r of rows) {
      const d: DeptPresence = byDept.get(r.dept) ?? { dept: r.dept, online: false, assignedCount: 0, staff: [] };
      d.assignedCount += 1;
      if (r.is_online) {
        d.online = true;
        d.staff.push({ name: r.full_name ?? "Staff", lastSeen: r.last_seen ? new Date(r.last_seen).toISOString() : null });
      }
      byDept.set(r.dept, d);
    }
    return { ok: true, data: Array.from(byDept.values()) };
  } catch (e) { return { ok: false, error: e instanceof Error ? e.message : "presence failed" }; }
}
