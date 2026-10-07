/**
 * What the console's banner and /api/system/status read: the last alerts, when each scheduled job last ran,
 * and what we know about the WhatsApp token. In memory on this instance - one instance serves production.
 */
export type AlertRecord = { kind: string; detail: string; at: number };
const alerts: AlertRecord[] = [];
const jobs = new Map<string, number>();
const started = Date.now();
export type TokenInfo = { valid: boolean | null; type: string | null; expiresAt: string | null; daysLeft: number | null; checkedAt: string | null };
let token: TokenInfo = { valid: null, type: null, expiresAt: null, daysLeft: null, checkedAt: null };

export function noteAlert(kind: string, detail: string): void {
  alerts.push({ kind, detail: String(detail ?? "").slice(0, 400), at: Date.now() });
  if (alerts.length > 200) alerts.shift();
}
export function markJob(name: string): void { jobs.set(name, Date.now()); }
export function setTokenInfo(t: TokenInfo): void { token = t; }
export function tokenInfo(): TokenInfo { return token; }

const MIN = 60 * 1000;
function recent(kinds: string[], withinMs: number): AlertRecord | null {
  const now = Date.now();
  for (let i = alerts.length - 1; i >= 0; i--) { const a = alerts[i]; if (now - a.at > withinMs) return null; if (kinds.includes(a.kind)) return a; }
  return null;
}

export function systemStatus() {
  const now = Date.now();
  const schedulerOn = (process.env.ARIA_SCHEDULER ?? "").toLowerCase() === "on";
  const lastJob = (n: string) => (jobs.has(n) ? new Date(jobs.get(n) as number).toISOString() : null);
  const ai = recent(["brain_failed", "ai_credits_exhausted"], 10 * MIN);
  const wa = recent(["meta_token_invalid", "meta_rejected"], 10 * MIN);
  const anyJobRecently = [...jobs.values()].some((t) => now - t < 10 * MIN);
  return {
    commit: (process.env.RENDER_GIT_COMMIT ?? "local").slice(0, 7),
    uptimeSeconds: Math.floor((now - started) / 1000),
    schedulerOn,
    jobs: { "every-5-min": lastJob("every-5-min"), hourly: lastJob("hourly"), daily: lastJob("daily") },
    // the scheduler is only trusted once it has actually run something in the last 10 minutes (or just started)
    jobsRunning: anyJobRecently || now - started < 6 * MIN,
    aiDown: !!ai,
    aiDetail: ai ? ai.detail : null,
    whatsappDown: !!wa,
    whatsappDetail: wa ? wa.detail : null,
    token,
    alerts: alerts.slice(-20).reverse().map((a) => ({ kind: a.kind, detail: a.detail, at: new Date(a.at).toISOString() })),
  };
}
