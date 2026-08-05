import { prisma } from "../db";

type Result<T> = { ok: true; data: T } | { ok: false; error: string };

function norm(r: any) {
  if (!r) return r;
  // createdAt -> ISO string; ensure plain JSON
  return { ...r, createdAt: r.createdAt instanceof Date ? r.createdAt.toISOString() : r.createdAt };
}

// active board: received + in_progress for the given hotel + departments
export async function listActiveRequests(hotelId: string, depts: string[]): Promise<Result<any[]>> {
  if (!hotelId || depts.length === 0) return { ok: true, data: [] };
  try {
    const rows = await prisma.$queryRawUnsafe<any[]>(
      `select * from "Request"
       where "hotelId" = $1 and department::text = any($2::text[])
         and status::text in ('received','in_progress')
       order by "createdAt" desc`,
      hotelId, depts
    );
    return { ok: true, data: rows.map(norm) };
  } catch (e) { return { ok: false, error: e instanceof Error ? e.message : "Could not load requests." }; }
}

// history: resolved
export async function listResolvedRequests(hotelId: string, depts: string[], limit = 200): Promise<Result<any[]>> {
  if (!hotelId || depts.length === 0) return { ok: true, data: [] };
  try {
    const rows = await prisma.$queryRawUnsafe<any[]>(
      `select * from "Request"
       where "hotelId" = $1 and department::text = any($2::text[]) and status::text = 'resolved'
       order by "createdAt" desc limit $3`,
      hotelId, depts, limit
    );
    return { ok: true, data: rows.map(norm) };
  } catch (e) { return { ok: false, error: e instanceof Error ? e.message : "Could not load history." }; }
}

// analytics: all rows in the last N days for the depts (any status)
export async function listRequestsSince(hotelId: string, depts: string[], days = 7): Promise<Result<any[]>> {
  if (!hotelId || depts.length === 0) return { ok: true, data: [] };
  try {
    const rows = await prisma.$queryRawUnsafe<any[]>(
      `select * from "Request"
       where "hotelId" = $1 and department::text = any($2::text[])
         and "createdAt" >= now() - ($3 || ' days')::interval
       order by "createdAt" desc limit 2000`,
      hotelId, depts, String(days)
    );
    return { ok: true, data: rows.map(norm) };
  } catch (e) { return { ok: false, error: e instanceof Error ? e.message : "Could not load analytics." }; }
}

// GM overview: all active requests for a hotel (all departments)
export async function listHotelActive(hotelId: string): Promise<Result<any[]>> {
  if (!hotelId) return { ok: true, data: [] };
  try {
    const rows = await prisma.$queryRawUnsafe<any[]>(
      `select * from "Request" where "hotelId" = $1 and status::text in ('received','in_progress') order by "createdAt" desc`,
      hotelId
    );
    return { ok: true, data: rows.map(norm) };
  } catch (e) { return { ok: false, error: e instanceof Error ? e.message : "Could not load." }; }
}

// FOUNDER: all active requests across every hotel (no hotel filter)
export async function listAllActive(): Promise<Result<any[]>> {
  try {
    const rows = await prisma.$queryRawUnsafe<any[]>(
      `select * from "Request" where status::text in ('received','in_progress') order by "createdAt" desc limit 1000`
    );
    return { ok: true, data: rows.map(norm) };
  } catch (e) { return { ok: false, error: e instanceof Error ? e.message : "Could not load." }; }
}

// FOUNDER: all requests in last N days across every hotel (for revenue/analytics)
export async function listAllSince(days = 30): Promise<Result<any[]>> {
  try {
    const rows = await prisma.$queryRawUnsafe<any[]>(
      `select * from "Request" where "createdAt" >= now() - ($1 || ' days')::interval order by "createdAt" desc limit 5000`,
      String(days)
    );
    return { ok: true, data: rows.map(norm) };
  } catch (e) { return { ok: false, error: e instanceof Error ? e.message : "Could not load." }; }
}

// GM dashboard: all requests for ONE hotel over the last N days (for charts)
export async function listHotelSince(hotelId: string, days = 7): Promise<Result<any[]>> {
  if (!hotelId) return { ok: true, data: [] };
  try {
    const rows = await prisma.$queryRawUnsafe<any[]>(
      `select * from "Request" where "hotelId" = $1 and "createdAt" >= now() - ($2 || ' days')::interval order by "createdAt" desc limit 3000`,
      hotelId, String(days)
    );
    return { ok: true, data: rows.map(norm) };
  } catch (e) { return { ok: false, error: e instanceof Error ? e.message : "Could not load." }; }
}