import { analyse, isNotice, percentile, type LtSent, type LtReply } from "../src/lib/loadAnalysis";

const FB = /one of our team/i;
const s = (guest: string, at: number, re: RegExp, id = guest + at): LtSent => ({ guest, topics: [re], at, ackMs: 10, status: 200, id, processed: true });
const r = (guest: string, at: number, body: string): LtReply => ({ guest, at, seenAt: at + 100, body });

describe("the load test matches replies to messages", () => {
  test("answered in order, with latency", () => {
    const res = analyse([s("g1", 0, /breakfast/i), s("g1", 10000, /pool/i)], [r("g1", 6000, "Breakfast is 7 to 10."), r("g1", 17000, "The pool is open until 8.")], FB);
    expect(res.answered).toBe(2); expect(res.verified).toBe(2); expect(res.orderErrors).toBe(0); expect(res.latenciesMs).toEqual([6000, 7000]);
  });
  test("replies that come back in the opposite order are an ordering error", () => {
    const res = analyse([s("g1", 0, /breakfast/i), s("g1", 500, /pool/i)], [r("g1", 4000, "The pool is open."), r("g1", 6000, "Breakfast is at 7.")], FB);
    expect(res.orderErrors).toBe(1);
  });
  test("one reply that answers both is not an error", () => {
    const res = analyse([s("g1", 0, /breakfast/i), s("g1", 500, /pool/i)], [r("g1", 5000, "Breakfast is at 7 and the pool opens at 8.")], FB);
    expect(res.answered).toBe(2); expect(res.orderErrors).toBe(0); expect(res.unanswered).toBe(0);
  });
  test("no reply is unanswered; the fallback is counted; other guests' replies do not count", () => {
    const res = analyse([s("g1", 0, /gym/i), s("g2", 0, /park/i)], [r("g3", 2000, "Parking is free."), r("g1", 3000, "Let me get one of our team on this.")], FB);
    expect(res.unanswered).toBe(1); expect(res.fallbacks).toBe(1); expect(res.answered).toBe(1); expect(res.verified).toBe(0);
  });
  test("multi-question coverage and percentiles", () => {
    const multi: LtSent = { guest: "g1", topics: [/breakfast/i, /pool/i, /wi-?fi/i], at: 0, ackMs: 5, status: 200, id: "m" };
    const res = analyse([multi], [r("g1", 8000, "Breakfast is at 7, the pool is open."), r("g1", 9000, "The WiFi password is sunanda123.")], FB);
    expect(res.coverage).toEqual([1]);
    expect(percentile([5, 1, 3, 2, 4], 50)).toBe(3); expect(percentile([], 90)).toBe(0); expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 90)).toBe(9);
  });
  test("the first-contact privacy notice is counted apart and never taken for an answer", () => {
    const notice = "Before we begin: I keep your messages only to handle your requests during your stay, and never share them with other guests. Reply STOP at any time and everything is erased.";
    expect(isNotice(notice)).toBe(true); expect(isNotice("Breakfast is 7 to 10.")).toBe(false);
    const res = analyse([s("g1", 0, /gym/i), s("g2", 0, /park/i)], [r("g1", 300, notice), r("g1", 9000, "The gym is open 24 hours."), r("g2", 250, notice)], FB);
    expect(res.notices).toBe(2); expect(res.noticeMs).toEqual([300, 250]);
    expect(res.answered).toBe(1); expect(res.unanswered).toBe(1); expect(res.latenciesMs).toEqual([9000]);
  });
  test("a multi-question message names the question its answer left out", () => {
    const multi: LtSent = { guest: "g1", topics: [/breakfast/i, /pool/i, /wi-?fi/i], at: 0, ackMs: 5, status: 200, id: "m" };
    const res = analyse([multi], [r("g1", 6000, "Breakfast is at 7 and the pool opens at 8.")], FB);
    expect(res.coverage).toEqual([2 / 3]); expect(res.uncovered).toEqual(["wi-?fi"]);
  });
});
