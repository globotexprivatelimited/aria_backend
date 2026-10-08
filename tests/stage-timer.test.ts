import { stageTimer, summarizeTimings } from "../src/lib/stageTimer";

describe("where a guest's wait goes (item 16)", () => {
  test("each mark charges the time since the last one to its stage; the reply time stops when the reply leaves", () => {
    let t = 1000;
    const timer = stageTimer(() => t);
    t += 40; timer.mark("store");
    t += 5; timer.mark("queue");
    t += 3000; timer.mark("brain");
    t += 200; timer.mark("send"); timer.replied();
    t += 500; timer.mark("requests");
    expect(timer.summary()).toEqual({ replyMs: 3245, totalMs: 3745, storeMs: 40, queueMs: 5, brainMs: 3000, sendMs: 200, requestsMs: 500 });
  });
  test("a stage marked twice adds up, and a reply never sent counts to the last moment", () => {
    let t = 0;
    const timer = stageTimer(() => t);
    t += 10; timer.mark("db");
    t += 30; timer.mark("ai");
    t += 15; timer.mark("db");
    expect(timer.summary()).toEqual({ replyMs: 55, totalMs: 55, dbMs: 25, aiMs: 30 });
  });
  test("pnpm timing reads the reply timing lines of a log - plain or with a timestamp in front - and ignores the rest", () => {
    const log = [
      JSON.stringify({ at: "x", level: "info", msg: "reply timing", phone: "+1***1", storeMs: 40, brainMs: 3000, replyMs: 3200, totalMs: 3500 }),
      "2026-10-08T06:00:00Z " + JSON.stringify({ msg: "reply timing", storeMs: 60, brainMs: 5000, replyMs: 5300, totalMs: 5400 }),
      JSON.stringify({ msg: "outbound reply", storeMs: 999 }),
      "not json, but it says reply timing",
    ].join("\n");
    const s = summarizeTimings(log);
    expect(s.replies).toBe(2);
    expect(s.rows.map((r) => r.stage)).toEqual(["store", "brain", "reply", "total"]);
    expect(s.rows.find((r) => r.stage === "brain")).toEqual({ stage: "brain", count: 2, median: 3000, p90: 5000, max: 5000 });
  });
});
