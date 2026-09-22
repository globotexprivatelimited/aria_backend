import { conditionFor, weatherForPrompt } from "../src/lib/weather";

describe("local weather", () => {
  test("rain codes are rain, clear codes are not", () => {
    expect(conditionFor(63).raining).toBe(true);
    expect(conditionFor(95).raining).toBe(true);
    expect(conditionFor(0)).toEqual({ text: "clear skies", raining: false });
  });
  test("unknown weather tells the brain not to describe it", () => {
    expect(weatherForPrompt(null)).toMatch(/not known/);
  });
  test("live weather reaches the brain with the facts that matter", () => {
    const line = weatherForPrompt({ place: "Bankura", tempC: 31, feelsC: 36, humidity: 78, condition: "mostly clear", raining: false, rainChance: 20, minC: 26, maxC: 33 });
    expect(line).toContain("Bankura");
    expect(line).toContain("feels like 36");
    expect(line).toContain("78% humidity");
  });
});
