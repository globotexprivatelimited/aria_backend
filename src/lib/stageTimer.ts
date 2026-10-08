/**
 * Where a guest's wait goes (pending item 16). stageTimer() starts the clock when a message reaches the API; each
 * mark(stage) charges the time since the previous mark to that stage; replied() notes the moment the reply left; and
 * summary() gives replyMs, totalMs and one <stage>Ms per stage - logged as "reply timing" and summed up by pnpm timing.
 */
export type StageTimer = { mark(stage: string): void; replied(): void; summary(): Record<string, number> };

export function stageTimer(now: () => number = Date.now): StageTimer {
  const start = now();
  let last = start;
  let repliedAt: number | null = null;
  const stages = new Map<string, number>();
  return {
    mark(stage) { const t = now(); stages.set(stage, (stages.get(stage) ?? 0) + (t - last)); last = t; },
    replied() { repliedAt = now(); },
    summary() {
      const t = now();
      const out: Record<string, number> = { replyMs: (repliedAt ?? t) - start, totalMs: t - start };
      for (const [k, v] of stages) out[k + "Ms"] = v;
      return out;
    },
  };
}

export type TimingRow = { stage: string; count: number; median: number; p90: number; max: number };

const pct = (xs: number[], p: number): number => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.ceil((p / 100) * s.length) - 1))];
};

/** The "reply timing" lines of a log (JSON lines; a timestamp in front, as in a Render download, is fine; other lines are ignored): one row per stage in pipeline order, then reply and total. */
export function summarizeTimings(text: string): { replies: number; rows: TimingRow[] } {
  const seen = new Map<string, number[]>();
  let replies = 0;
  for (const line of text.split(/\r?\n/)) {
    if (!line.includes("reply timing")) continue;
    let r: Record<string, unknown>;
    try { r = JSON.parse(line.slice(line.indexOf("{"))) as Record<string, unknown>; } catch { continue; }
    if (!r || r.msg !== "reply timing") continue;
    replies++;
    for (const [k, v] of Object.entries(r)) {
      if (!/Ms$/.test(k) || typeof v !== "number" || !Number.isFinite(v)) continue;
      const xs = seen.get(k) ?? [];
      xs.push(v);
      seen.set(k, xs);
    }
  }
  const keys = [...seen.keys()].filter((k) => k !== "replyMs" && k !== "totalMs");
  for (const k of ["replyMs", "totalMs"]) if (seen.has(k)) keys.push(k);
  return {
    replies,
    rows: keys.map((k) => { const xs = seen.get(k) ?? []; return { stage: k.replace(/Ms$/, ""), count: xs.length, median: pct(xs, 50), p90: pct(xs, 90), max: Math.max(...xs) }; }),
  };
}
