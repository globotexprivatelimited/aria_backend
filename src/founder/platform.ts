import { prisma } from "../db";
type Result<T> = { ok: true; data: T } | { ok: false; error: string };

// ---------- plans & billing ----------
export type PlanRow = { code: string; name: string; monthlyPrice: number; maxStations: number | null; features: string[] };

export async function getPlans(): Promise<Result<PlanRow[]>> {
  try {
    const rows = await prisma.$queryRawUnsafe<any[]>(`select code, name, monthly_price, max_stations, features from plans order by sort_order`);
    return { ok: true, data: rows.map((r) => ({
      code: r.code, name: r.name, monthlyPrice: Number(r.monthly_price ?? 0),
      maxStations: r.max_stations == null ? null : Number(r.max_stations),
      features: Array.isArray(r.features) ? r.features : [],
    })) };
  } catch (e) { return { ok: false, error: e instanceof Error ? e.message : "plans failed" }; }
}

export async function setHotelPlan(hotelId: string, planCode: string): Promise<Result<{ ok: true }>> {
  if (!hotelId || !planCode) return { ok: false, error: "hotelId and planCode required" };
  try {
    const p = await prisma.$queryRawUnsafe<any[]>(`select code from plans where code = $1`, planCode);
    if (!p[0]) return { ok: false, error: "Unknown plan." };
    const pilotEnds = planCode === "pilot" ? `now() + interval '30 days'` : "null";
    await prisma.$executeRawUnsafe(
      `update "Hotel" set plan_code = $2, plan_started_at = now(), pilot_ends_at = ${pilotEnds} where "hotelId" = $1`, hotelId, planCode);
    return { ok: true, data: { ok: true } };
  } catch (e) { return { ok: false, error: e instanceof Error ? e.message : "failed" }; }
}

export async function setRevenueShare(hotelId: string, percent: number): Promise<Result<{ ok: true }>> {
  if (!hotelId) return { ok: false, error: "hotelId required" };
  if (percent < 0 || percent > 100) return { ok: false, error: "Percent must be between 0 and 100." };
  try {
    await prisma.$executeRawUnsafe(`update "Hotel" set "revenueSharePercent" = $2 where "hotelId" = $1`, hotelId, percent);
    return { ok: true, data: { ok: true } };
  } catch (e) { return { ok: false, error: e instanceof Error ? e.message : "failed" }; }
}

export async function setHotelActive(hotelId: string, active: boolean): Promise<Result<{ ok: true }>> {
  try {
    await prisma.$executeRawUnsafe(`update "Hotel" set "isActive" = $2 where "hotelId" = $1`, hotelId, active);
    return { ok: true, data: { ok: true } };
  } catch (e) { return { ok: false, error: e instanceof Error ? e.message : "failed" }; }
}

export type Billing = {
  mrr: number; costToServe: number; grossMarginPct: number; pilotsRunning: number;
  byPlan: { code: string; name: string; hotels: number; mrr: number }[];
  costs: { category: string; amount: number }[];
};

export async function getBilling(): Promise<Result<Billing>> {
  try {
    const rows = await prisma.$queryRawUnsafe<any[]>(
      `select h."hotelId", h.plan_code, h."isActive", p.name plan_name, coalesce(p.monthly_price,0) price
         from "Hotel" h left join plans p on p.code = h.plan_code`);
    const active = rows.filter((r) => r.isActive);
    const mrr = active.reduce((s, r) => s + Number(r.price ?? 0), 0);

    let costs: { category: string; amount: number }[] = [];
    try {
      const c = await prisma.$queryRawUnsafe<any[]>(
        `select category, coalesce(sum(amount),0)::float amount from platform_costs
          where occurred_on > current_date - 30 group by category order by amount desc`);
      costs = c.map((x) => ({ category: x.category, amount: Number(x.amount ?? 0) }));
    } catch {}
    const costToServe = costs.reduce((s, c) => s + c.amount, 0);

    const planMap = new Map<string, { name: string; hotels: number; mrr: number }>();
    for (const r of active) {
      const k = r.plan_code ?? "pilot";
      const e = planMap.get(k) ?? { name: r.plan_name ?? k, hotels: 0, mrr: 0 };
      e.hotels += 1; e.mrr += Number(r.price ?? 0); planMap.set(k, e);
    }

    return { ok: true, data: {
      mrr, costToServe,
      grossMarginPct: mrr > 0 ? Math.round(((mrr - costToServe) / mrr) * 100) : 0,
      pilotsRunning: active.filter((r) => (r.plan_code ?? "pilot") === "pilot").length,
      byPlan: Array.from(planMap.entries()).map(([code, v]) => ({ code, ...v })),
      costs,
    } };
  } catch (e) { return { ok: false, error: e instanceof Error ? e.message : "billing failed" }; }
}

// ---------- onboarding ----------
const STEPS = ["number_provisioned", "menu_loaded", "stations_paired", "staff_trained", "gm_assigned"] as const;
export type OnboardingRow = {
  hotelId: string; name: string; city: string | null; roomCount: number | null;
  owner: string | null; gmName: string | null; daysInSetup: number;
  steps: Record<string, boolean>; done: number; total: number; blocker: string | null; live: boolean;
};

export async function getOnboarding(): Promise<Result<{ rows: OnboardingRow[]; totals: Record<string, number> }>> {
  try {
    const rows = await prisma.$queryRawUnsafe<any[]>(
      `select h."hotelId", h.name, h.city, h.room_count, h.account_owner,
              o.number_provisioned, o.menu_loaded, o.stations_paired, o.staff_trained, o.gm_assigned,
              o.blocker, o.started_at, o.went_live_at,
              (select s.full_name from staff_users s where s.hotel_id = h."hotelId" and s.role='gm' limit 1) gm_name
         from "Hotel" h left join onboarding_progress o on o.hotel_id = h."hotelId"
        order by o.went_live_at nulls first, o.started_at`);

    const out: OnboardingRow[] = rows.map((r) => {
      const steps: Record<string, boolean> = {};
      let done = 0;
      for (const s of STEPS) { steps[s] = !!r[s]; if (r[s]) done += 1; }
      return {
        hotelId: String(r.hotelId), name: r.name, city: r.city ?? null,
        roomCount: r.room_count == null ? null : Number(r.room_count),
        owner: r.account_owner ?? null, gmName: r.gm_name ?? null,
        daysInSetup: r.started_at ? Math.max(0, Math.round((Date.now() - new Date(r.started_at).getTime()) / 86400000)) : 0,
        steps, done, total: STEPS.length, blocker: r.blocker ?? null, live: !!r.went_live_at,
      };
    });
    const inSetup = out.filter((x) => !x.live);
    return { ok: true, data: { rows: out, totals: {
      inSetup: inSetup.length,
      liveTotal: out.filter((x) => x.live).length,
      stepsPerLaunch: STEPS.length,
      roomsComing: inSetup.reduce((s, x) => s + (x.roomCount ?? 0), 0),
    } } };
  } catch (e) { return { ok: false, error: e instanceof Error ? e.message : "onboarding failed" }; }
}

export async function setOnboardingStep(hotelId: string, step: string, value: boolean): Promise<Result<{ ok: true }>> {
  if (!STEPS.includes(step as never)) return { ok: false, error: "Unknown step." };
  try {
    await prisma.$executeRawUnsafe(
      `insert into onboarding_progress (hotel_id, ${step}) values ($1, $2)
       on conflict (hotel_id) do update set ${step} = excluded.${step}`, hotelId, value);
    // going live when every step is done
    await prisma.$executeRawUnsafe(
      `update onboarding_progress set went_live_at = case
         when number_provisioned and menu_loaded and stations_paired and staff_trained and gm_assigned
           then coalesce(went_live_at, now()) else null end
       where hotel_id = $1`, hotelId);
    return { ok: true, data: { ok: true } };
  } catch (e) { return { ok: false, error: e instanceof Error ? e.message : "failed" }; }
}

export async function setBlocker(hotelId: string, blocker: string | null): Promise<Result<{ ok: true }>> {
  try {
    await prisma.$executeRawUnsafe(
      `insert into onboarding_progress (hotel_id, blocker) values ($1,$2)
       on conflict (hotel_id) do update set blocker = excluded.blocker`, hotelId, blocker);
    return { ok: true, data: { ok: true } };
  } catch (e) { return { ok: false, error: e instanceof Error ? e.message : "failed" }; }
}
