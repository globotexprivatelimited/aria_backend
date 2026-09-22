import { momentOf, picksFor, attachWeather } from "../src/menu/catalog";

const base = { place: "Burdwan", feelsC: null, humidity: 80, condition: "rain", rainChance: 90, minC: 25, maxC: 30 };
const rainNow = { ...base, tempC: 27, raining: true };
const hotDry = { ...base, tempC: 35, feelsC: 39, raining: false, condition: "clear skies", rainChance: 0 };
const now = new Date("2026-09-22T09:00:00Z");
const item = (o: any) => ({ id: o.code, dept: "fb", kind: "food", category: null, diet: null, available: true, stock: 100, servedFrom: null, servedTo: null, bestseller: false, signature: false, ageRestricted: false, prepMins: 0, durationMin: 0, description: null, ...o });
const makeCatalog = (): any => ({ items: [item({ code: "F1", name: "Samosa", price: 150, category: "Snacks" }), item({ code: "F2", name: "Nimbu Pani", price: 90, category: "Beverages", kind: "beverage" })], slots: [], timezone: "Asia/Kolkata", now, configured: { fb: true } });

describe("suggestions follow the sky", () => {
  test("live weather decides the season, whatever the calendar says", () => {
    expect(momentOf("Asia/Kolkata", now, rainNow as any).season).toBe("rainy");
    expect(momentOf("Asia/Kolkata", now, hotDry as any).season).toBe("hot");
  });
  test("without live weather, a suggestion claims only the season", () => {
    const c = makeCatalog(); attachWeather(c, null);
    const samosa = picksFor(c, "fb", new Map(), { limit: 3, minScore: 2 }).find((p) => p.item.name === "Samosa");
    expect(samosa?.reason).toBe("a monsoon favourite");
  });
  test("real rain earns the rainy-day line", () => {
    const c = makeCatalog(); attachWeather(c, rainNow as any);
    const samosa = picksFor(c, "fb", new Map(), { limit: 3, minScore: 2 }).find((p) => p.item.name === "Samosa");
    expect(samosa?.reason).toBe("made for a rainy day");
  });
  test("real heat puts the cool drink first and drops the fried snack", () => {
    const c = makeCatalog(); attachWeather(c, hotDry as any);
    const picks = picksFor(c, "fb", new Map(), { limit: 3, minScore: 2 });
    expect(picks[0]?.item.name).toBe("Nimbu Pani");
    expect(picks.find((p) => p.item.name === "Samosa")).toBeUndefined();
  });
});
