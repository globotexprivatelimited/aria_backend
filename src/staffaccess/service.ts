import { prisma } from "../db";
type Result<T> = { ok: true; data: T } | { ok: false; error: string };

const ALL_DEPTS = [
  { dept: "fb", label: "In-Room Dining" },
  { dept: "housekeeping", label: "Housekeeping" },
  { dept: "spa", label: "Spa" },
  { dept: "front_desk", label: "Front Desk" },
];

export async function ensureStaffActiveColumn(): Promise<void> {
  try { await prisma.$executeRawUnsafe(`alter table staff_departments add column if not exists active boolean not null default true`); } catch {}
}

export async function getStaffAccess(hotelId: string): Promise<Result<any[]>> {
  if (!hotelId) return { ok: false, error: "hotelId required" };
  try { await ensureStaffActiveColumn(); return { ok: true, data: [] }; }
  catch (e) { return { ok: false, error: e instanceof Error ? e.message : "failed" }; }
}

export async function setStaffDeptAccess(hotelId: string, staffId: string, dept: string, active: boolean): Promise<Result<any>> {
  const sid = String(staffId ?? "").trim();
  const d = String(dept ?? "").trim();
  if (!sid || !d) return { ok: false, error: "staffId and dept required (staffId=" + JSON.stringify(staffId) + ", dept=" + JSON.stringify(dept) + ")" };
  try {
    await ensureStaffActiveColumn();
    // Try update first using text comparison (avoids any uuid-cast issues)
    const updated = await prisma.$executeRawUnsafe(
      `update staff_departments set active=$3 where staff_user_id::text=$1 and dept=$2`, sid, d, active);
    if (updated && Number(updated) > 0) {
      return { ok: true, data: { staffId: sid, dept: d, active, action: "updated" } };
    }
    // No row existed - insert. Verify the staff exists first for a clean error.
    const staffExists = await prisma.$queryRawUnsafe<any[]>(`select 1 from staff_users where id::text=$1`, sid);
    if (!staffExists[0]) {
      return { ok: false, error: "No staff with id " + sid };
    }
    await prisma.$executeRawUnsafe(
      `insert into staff_departments (staff_user_id, dept, active) values ($1::uuid, $2, $3)`, sid, d, active);
    return { ok: true, data: { staffId: sid, dept: d, active, action: "inserted" } };
  } catch (e) {
    return { ok: false, error: (e instanceof Error ? e.message : "failed") + " [sid=" + sid + ", dept=" + d + "]" };
  }
}
