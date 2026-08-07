import { prisma } from "../db";
type Result<T> = { ok: true; data: T } | { ok: false; error: string };

const mins = (a: Date | null, b: Date | null): number | null =>
  a && b ? Math.max(0, Math.round((new Date(b).getTime() - new Date(a).getTime()) / 60000)) : null;

export type DetailRequest = {
  id: string; room: string | null; detail: string | null; status: string; priority: string;
  claimedBy: string | null; createdAt: string; claimedAt: string | null; resolvedAt: string | null;
  waitingMins: number | null; timeToClaimMins: number | null; timeToResolveMins: number | null;
};
export type StaffStat = { name: string; handledToday: number; avgResponseMins: number | null; avgResolveMins: number | null };

export async function getDepartmentDetail(hotelId: string, dept: string): Promise<Result<{
  requests: DetailRequest[]; staff: StaffStat[];
  counts: { open: number; inProgress: number; resolvedToday: number };
}>> {
  if (!hotelId || !dept) return { ok: false, error: "hotelId and dept required" };
  try {
    const rows = await prisma.$queryRawUnsafe<any[]>(
      `select id, "roomNumber", "requestDetail", status::text as status, priority::text as priority,
              "claimedBy", "claimedAt", "resolvedAt", "createdAt"
         from "Request"
        where "hotelId" = $1 and department::text = $2
          and ("createdAt" > now() - interval '7 days' or status::text <> 'resolved')
        order by case status::text when 'received' then 0 when 'in_progress' then 1 else 2 end, "createdAt" desc
        limit 100`, hotelId, dept);

    const now = new Date();
    const requests: DetailRequest[] = rows.map((r) => ({
      id: r.id,
      room: r.roomNumber ?? null,
      detail: r.requestDetail ?? null,
      status: r.status,
      priority: r.priority,
      claimedBy: r.claimedBy ?? null,
      createdAt: new Date(r.createdAt).toISOString(),
      claimedAt: r.claimedAt ? new Date(r.claimedAt).toISOString() : null,
      resolvedAt: r.resolvedAt ? new Date(r.resolvedAt).toISOString() : null,
      waitingMins: r.status === "received" ? mins(r.createdAt, now) : null,
      timeToClaimMins: mins(r.createdAt, r.claimedAt),
      timeToResolveMins: mins(r.createdAt, r.resolvedAt),
    }));

    const startOfToday = new Date(); startOfToday.setHours(0, 0, 0, 0);
    const byStaff = new Map<string, { n: number; resp: number[]; res: number[] }>();
    for (const r of requests) {
      if (!r.claimedBy) continue;
      const resolvedToday = r.resolvedAt && new Date(r.resolvedAt) >= startOfToday;
      const e = byStaff.get(r.claimedBy) ?? { n: 0, resp: [], res: [] };
      if (resolvedToday) e.n += 1;
      if (r.timeToClaimMins != null) e.resp.push(r.timeToClaimMins);
      if (r.timeToResolveMins != null) e.res.push(r.timeToResolveMins);
      byStaff.set(r.claimedBy, e);
    }
    const avg = (a: number[]) => (a.length ? Math.round(a.reduce((s, x) => s + x, 0) / a.length) : null);
    const staff: StaffStat[] = Array.from(byStaff.entries())
      .map(([name, e]) => ({ name, handledToday: e.n, avgResponseMins: avg(e.resp), avgResolveMins: avg(e.res) }))
      .sort((a, b) => b.handledToday - a.handledToday);

    const counts = {
      open: requests.filter((r) => r.status === "received").length,
      inProgress: requests.filter((r) => r.status === "in_progress").length,
      resolvedToday: requests.filter((r) => r.resolvedAt && new Date(r.resolvedAt) >= startOfToday).length,
    };
    return { ok: true, data: { requests, staff, counts } };
  } catch (e) { return { ok: false, error: e instanceof Error ? e.message : "detail failed" }; }
}
