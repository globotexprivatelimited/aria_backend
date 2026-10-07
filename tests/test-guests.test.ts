import { isTestGuest } from "../src/lib/testGuests";

describe("test guests are recognised", () => {
  const saved = { p: process.env.TEST_PHONES, x: process.env.TEST_PHONE_PREFIXES };
  afterAll(() => { if (saved.p === undefined) delete process.env.TEST_PHONES; else process.env.TEST_PHONES = saved.p; if (saved.x === undefined) delete process.env.TEST_PHONE_PREFIXES; else process.env.TEST_PHONE_PREFIXES = saved.x; });
  test("by name, by number, by prefix - and real guests are not", () => {
    process.env.TEST_PHONES = "+919999900001, +919999900002"; process.env.TEST_PHONE_PREFIXES = "+9188888";
    expect(isTestGuest("Harness 3", "+919038012530")).toMatch(/name/);
    expect(isTestGuest("Rahul Verma", "+919999900002")).toBe("TEST_PHONES");
    expect(isTestGuest("Rahul Verma", "+918888812345")).toBe("TEST_PHONE_PREFIXES");
    expect(isTestGuest("Rahul Verma", "+919038012530")).toBeNull();
    expect(isTestGuest("Harnessing Co", "+919038012530")).toBeNull();
  });
});
