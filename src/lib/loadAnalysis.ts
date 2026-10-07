/**
 * The load test's arithmetic. A message is answered by the first reply after it that mentions its topic, or failing
 * that the first reply not yet used; two replies whose topics come back in the opposite order are an ordering error;
 * a reply that is the "someone from the team will help" fallback means the AI was not answering.
 * The privacy notice a guest gets on first contact is its own message, not an answer: it is counted apart and never
 * matched to a question. A reply that does not mention what was asked is counted as answered but listed as off topic.
 */
export type LtSent = { guest: string; topics: RegExp[]; ask?: string; at: number; ackMs: number; status: number; id: string; processed?: boolean };
export type LtReply = { guest: string; at: number; seenAt: number; body: string };
export type LtResult = { sent: number; acked: number; processed: number; answered: number; unanswered: number; verified: number; orderErrors: number; fallbacks: number; latenciesMs: number[]; ackMs: number[]; coverage: number[]; uncovered: string[]; offTopic: string[]; notices: number; noticeMs: number[] };

/** The first-contact privacy notice (src/privacy/consent.ts, CONSENT_NOTICE). */
export const NOTICE = /^\s*before we begin\b|reply stop at any time/i;
export function isNotice(body: string, notice: RegExp | null = NOTICE): boolean { return !!notice && notice.test(body); }

export function percentile(xs: number[], p: number): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.ceil((p / 100) * s.length) - 1))];
}

export function analyse(sent: LtSent[], replies: LtReply[], fallback: RegExp, skewToleranceMs = 1500, notice: RegExp | null = NOTICE): LtResult {
  const res: LtResult = { sent: sent.length, acked: sent.filter((s) => s.status === 200).length, processed: sent.filter((s) => s.processed !== false).length, answered: 0, unanswered: 0, verified: 0, orderErrors: 0, fallbacks: 0, latenciesMs: [], ackMs: sent.map((s) => s.ackMs), coverage: [], uncovered: [], offTopic: [], notices: 0, noticeMs: [] };
  const byGuest = new Map<string, LtSent[]>();
  for (const s of sent) byGuest.set(s.guest, [...(byGuest.get(s.guest) ?? []), s]);
  const fallbacks = new Set<LtReply>();
  for (const [guest, list] of byGuest) {
    const msgs = [...list].sort((a, b) => a.at - b.at);
    const mine = replies.filter((r) => r.guest === guest && r.seenAt >= msgs[0].at && r.at >= msgs[0].at - skewToleranceMs).sort((a, b) => a.at - b.at);
    const notices = mine.filter((r) => isNotice(r.body, notice));
    res.notices += notices.length;
    if (notices.length) res.noticeMs.push(Math.max(0, notices[0].at - msgs[0].at));
    const reps = mine.filter((r) => !isNotice(r.body, notice));
    for (const r of reps) if (fallback.test(r.body)) fallbacks.add(r);
    const used = new Set<number>();
    const picks: { idx: number; verified: boolean }[] = [];
    for (const m of msgs) {
      const matches = (r: LtReply): boolean => m.topics.some((t) => t.test(r.body));
      const cands = reps.map((r, idx) => ({ r, idx })).filter(({ r }) => r.seenAt >= m.at && r.at >= m.at - skewToleranceMs);
      const pick = cands.find((c) => matches(c.r)) ?? cands.find((c) => !used.has(c.idx));
      if (!pick) { res.unanswered++; picks.push({ idx: -1, verified: false }); continue; }
      used.add(pick.idx);
      res.answered++;
      const verified = matches(pick.r);
      if (verified) res.verified++;
      else res.offTopic.push((m.ask ?? m.topics.map((t) => t.source).join(", ")).slice(0, 60) + " -> " + pick.r.body.replace(/\s+/g, " ").trim().slice(0, 90));
      res.latenciesMs.push(Math.max(0, pick.r.at - m.at));
      picks.push({ idx: pick.idx, verified });
      const window = reps.filter((r) => r.at >= pick.r.at && r.at <= pick.r.at + 60000).map((r) => r.body).join(" ");
      const missing = m.topics.filter((t) => !t.test(window));
      res.coverage.push(m.topics.length ? (m.topics.length - missing.length) / m.topics.length : 1);
      for (const t of missing) res.uncovered.push(t.source);
    }
    for (let i = 1; i < picks.length; i++) { const a = picks[i - 1], b = picks[i]; if (a.verified && b.verified && b.idx < a.idx) res.orderErrors++; }
  }
  res.fallbacks = fallbacks.size;
  return res;
}
