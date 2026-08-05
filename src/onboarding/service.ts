import { prisma } from "../db";
import bcrypt from "bcryptjs";
import { randomUUID } from "crypto";

// Atomically allocate the next hotel number (1, 2, 3...). Single UPDATE ... RETURNING is
// race-safe: two concurrent registrations can never receive the same number.
async function nextHotelNumber(): Promise<number> {
  const rows = await prisma.$queryRawUnsafe<{ value: bigint }[]>(
    `update id_counters set value = value + 1 where name = 'hotel' returning value`
  );
  if (!rows || rows.length === 0) throw new Error("hotel counter missing");
  return Number(rows[0].value);
}

type Result<T> = { ok: true; data: T } | { ok: false; error: string };

async function createLogin(email: string, password: string, role: string, hotelId: string, fullName: string, phone?: string): Promise<Result<{ authUserId: string }>> {
  // OUR auth: no Supabase Auth. Generate an id, store email + bcrypt password_hash on staff_users.
  if (!email || !password) return { ok: false, error: "Email and password are required." };
  // reject duplicate email
  const existing = await prisma.$queryRawUnsafe<{ id: string }[]>(`select id from staff_users where lower(email) = lower($1) limit 1`, email);
  if (existing && existing.length > 0) return { ok: false, error: "An account with this email already exists." };
  const authUserId = randomUUID();
  const hash = await bcrypt.hash(password, 10);
  try {
    await prisma.$executeRawUnsafe(
      `insert into staff_users (auth_user_id, hotel_id, role, full_name, phone, email, password_hash) values ($1::uuid, $2, $3, $4, $5, $6, $7)`,
      authUserId, hotelId, role, fullName, phone ?? null, email, hash
    );
  } catch (e) {
    console.log("CREATELOGIN FAIL >>> role:", role, "hotelId:", JSON.stringify(hotelId), "email:", email, "err:", e instanceof Error ? e.message : String(e));
    return { ok: false, error: e instanceof Error ? e.message : "Could not create the account." };
  }
  return { ok: true, data: { authUserId } };
}

export async function createGM(email: string, password: string, fullName: string, phone?: string) {
  return createLogin(email, password, "gm", "", fullName, phone);
}

export async function createHotel(gmAuthUserId: string, details: {
  name: string; address?: string; city?: string;
  roomCount?: number; checkInTime?: string; checkOutTime?: string; contactPhone?: string;
}): Promise<Result<{ hotelId: string }>> {
  // allocate the next sequential hotel number (1, 2, 3...) - unique regardless of name
  const hotelId = String(await nextHotelNumber());
  const token = "htk_" + Math.random().toString(36).slice(2, 14) + Date.now().toString(36);
  try {
    const hotelRowId = "htl_" + Math.random().toString(36).slice(2, 12) + Date.now().toString(36);
    const waNumber = details.contactPhone ?? ("pending-" + hotelId);
    console.log("HOTEL INSERT >>> id:", hotelRowId, "hotelId:", hotelId, "name:", JSON.stringify(details.name), "wa:", waNumber);
    await prisma.$executeRawUnsafe(
      `insert into "Hotel" ("id", "hotelId", name, "whatsappNumber", "webhookToken", address, city, room_count, check_in_time, check_out_time, contact_phone, onboarded)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, true)
       on conflict ("hotelId") do update set name=$3, address=$6, city=$7, room_count=$8, check_in_time=$9, check_out_time=$10, contact_phone=$11, onboarded=true`,
      hotelRowId, hotelId, details.name, waNumber, token, details.address ?? null, details.city ?? null,
      details.roomCount ?? null, details.checkInTime ?? null, details.checkOutTime ?? null, details.contactPhone ?? null
    );
    console.log("LINKING GM >>> hotelId:", hotelId, "gmAuthUserId:", gmAuthUserId);
    await prisma.$executeRawUnsafe(
      `update staff_users set hotel_id=$1 where auth_user_id=$2::uuid and role='gm'`,
      hotelId, gmAuthUserId
    );
    console.log("LINKING GM >>> done");
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not save the hotel." };
  }
  return { ok: true, data: { hotelId } };
}

export async function setDepartments(hotelId: string, depts: { dept: string; staffNumber?: string }[]): Promise<Result<{ count: number }>> {
  try {
    for (const d of depts) {
      await prisma.$executeRawUnsafe(
        `insert into hotel_departments (hotel_id, dept, staff_number, enabled) values ($1, $2, $3, true)
         on conflict (hotel_id, dept) do update set staff_number=$3, enabled=true`,
        hotelId, d.dept, d.staffNumber ?? null
      );
    }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not save departments." };
  }
  return { ok: true, data: { count: depts.length } };
}

export async function createStaff(hotelId: string, departments: string[], email: string, password: string, fullName: string, phone?: string): Promise<Result<{ authUserId: string }>> {
  // one login + one staff_users row (generic "staff" role); departments live in staff_departments
  const login = await createLogin(email, password, "staff", hotelId, fullName, phone);
  if (!login.ok) return login;
  const authUserId = login.data.authUserId;
  try {
    // find the staff_users row id we just created, then add one row per department
    const rows = await prisma.$queryRawUnsafe<{ id: string }[]>(
      `select id from staff_users where auth_user_id = $1::uuid`, authUserId
    );
    const staffUserId = rows?.[0]?.id;
    if (!staffUserId) throw new Error("staff row not found after creation");
    // set email + password_hash on the row so this staffer can log in via OUR auth system
    const staffHash = await bcrypt.hash(password, 10);
    await prisma.$executeRawUnsafe(
      `update staff_users set email = $1, password_hash = $2 where id = $3::uuid`,
      email, staffHash, staffUserId
    );
    for (const dept of departments) {
      await prisma.$executeRawUnsafe(
        `insert into staff_departments (staff_user_id, dept) values ($1::uuid, $2)
         on conflict (staff_user_id, dept) do nothing`,
        staffUserId, dept
      );
    }
  } catch (e) {
    // roll back: remove the staff_users row we just created
    await prisma.$executeRawUnsafe(`delete from staff_users where auth_user_id = $1::uuid`, authUserId);
    return { ok: false, error: e instanceof Error ? e.message : "Could not assign departments." };
  }
  return { ok: true, data: { authUserId } };
}

// list all staff for a hotel with their assigned departments
export async function listStaff(hotelId: string): Promise<Result<{ id: string; fullName: string; email: string; phone: string | null; departments: string[] }[]>> {
  try {
    const rows = await prisma.$queryRawUnsafe<{ id: string; auth_user_id: string; full_name: string; phone: string | null; email: string | null; depts: string | null }[]>(`
      select su.id, su.auth_user_id, su.full_name, su.phone, su.email,
             string_agg(sd.dept, ',' order by sd.dept) as depts
      from staff_users su
      left join staff_departments sd on sd.staff_user_id = su.id
      where su.hotel_id = $1 and su.role = 'staff'
      group by su.id, su.auth_user_id, su.full_name, su.phone, su.email
      order by su.created_at desc
    `, hotelId);
    // emails live on the staff_users.email column now (our auth) - no Supabase lookup
    const staff = rows.map((r) => ({
      id: r.id, fullName: r.full_name, email: r.email ?? "", phone: r.phone,
      departments: r.depts ? r.depts.split(",") : [],
    }));
    return { ok: true, data: staff };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not load staff." };
  }
}


// GM resets one of their own staff's password (hotelId guard ensures cross-tenant safety)
export async function resetStaffPassword(hotelId: string, staffId: string, newPassword: string): Promise<Result<{ email: string }>> {
  if (!newPassword || newPassword.length < 8) return { ok: false, error: "Password must be at least 8 characters." };
  try {
    // confirm this staffer belongs to this hotel, get their auth_user_id
    const rows = await prisma.$queryRawUnsafe<{ auth_user_id: string }[]>(
      `select auth_user_id from staff_users where id = $1::uuid and hotel_id = $2 and role = 'staff'`,
      staffId, hotelId
    );
    const authUserId = rows?.[0]?.auth_user_id;
    if (!authUserId) return { ok: false, error: "Staff member not found for this hotel." };
    // write the new password into OUR auth system (staff_users.password_hash), not Supabase Auth
    const hash = await bcrypt.hash(newPassword, 10);
    const updated = await prisma.$queryRawUnsafe<{ email: string }[]>(
      `update staff_users set password_hash = $1 where id = $2::uuid and hotel_id = $3 returning email`,
      hash, staffId, hotelId
    );
    return { ok: true, data: { email: updated?.[0]?.email ?? "" } };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not reset password." };
  }
}
