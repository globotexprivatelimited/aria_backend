import { throttle, classify } from "../src/lib/alerts";
import { noteAlert, markJob, systemStatus } from "../src/lib/status";

describe("alerts reach a person once, not thirty times - and the console can see them", () => {
  test("one email per kind per half hour", () => {
    const t0 = 1_000_000_000_000;
    expect(throttle("job_failed", t0)).toBe(true);
    expect(throttle("job_failed", t0 + 5 * 60 * 1000)).toBe(false);
    expect(throttle("brain_failed", t0 + 5 * 60 * 1000)).toBe(true);
    expect(throttle("job_failed", t0 + 31 * 60 * 1000)).toBe(true);
  });
  test("running out of AI credit is its own alert", () => {
    expect(classify("brain_failed", "400 Your credit balance is too low to access the Anthropic API")).toBe("ai_credits_exhausted");
    expect(classify("brain_failed", "529 overloaded")).toBe("brain_failed");
  });
  test("the status the banner reads", () => {
    noteAlert("ai_credits_exhausted", "credit balance is too low");
    markJob("every-5-min");
    const s = systemStatus();
    expect(s.aiDown).toBe(true);
    expect(s.jobs["every-5-min"]).not.toBeNull();
    expect(s.alerts[0].kind).toBe("ai_credits_exhausted");
  });
});
