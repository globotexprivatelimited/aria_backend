import { verifyReply, guardModelReply, hasQualifier, menuDigest } from "../src/menu/catalog";

const item = (o: any) => ({ id: o.code, dept: "fb", kind: "food", category: null, diet: null, available: true, stock: 100, servedFrom: null, servedTo: null, bestseller: false, signature: false, ageRestricted: false, prepMins: 0, durationMin: 0, description: null, ...o });
const catalog: any = {
  items: [
    item({ code: "F1", name: "Samosa", price: 150, category: "Snacks" }),
    item({ code: "F2", name: "Pakora", price: 120, category: "Snacks" }),
    item({ code: "F3", name: "Mutton Rogan Josh", price: 420, category: "Mains" }),
    item({ code: "S1", name: "Facial", price: 500, dept: "spa", kind: "treatment", durationMin: 60 }),
  ],
  slots: [],
  timezone: "Asia/Kolkata",
  now: new Date("2026-09-22T09:00:00Z"),
  configured: { fb: true, spa: true, dining: false, housekeeping: false, maintenance: false, front_desk: false },
};
catalog.byCode = new Map(catalog.items.map((i: any) => [i.code, i]));

describe("what reaches the guest", () => {
  test("markdown bold becomes WhatsApp bold", () => {
    expect(verifyReply("Try the **Samosa** today", catalog)).toBe("Try the *Samosa* today");
  });
  test("internal catalogue codes are never shown", () => {
    const out = verifyReply("our *Facial* (S1 - \u20B9500, 60 min)", catalog);
    expect(out).not.toMatch(/\bS1\b/);
    expect(out).toContain("\u20B9500");
  });
  test("a wrong price on a real dish is corrected", () => {
    expect(verifyReply("Samosa (\u20B9999) is lovely", catalog)).toContain("\u20B9150");
  });
  test("a sentence pricing something the hotel does not sell is removed", () => {
    const out = guardModelReply("We have Samosa at \u20B9150. The Biryani at \u20B9380 is a favourite. Shall I send some?", catalog);
    expect(out).toContain("Samosa");
    expect(out).not.toContain("Biryani");
    expect(out).toContain("Shall I send some?");
  });
  test("multiples of a real price are allowed", () => {
    const text = "Two samosas come to \u20B9300.";
    expect(guardModelReply(text, catalog)).toBe(text);
  });
  test("a reply made only of invented prices falls back safely", () => {
    expect(guardModelReply("- *Biryani* \u20B9380", catalog)).toMatch(/team/);
  });
  test("qualified menu asks go to the model, a bare menu ask does not", () => {
    expect(hasQualifier("lunch menu")).toBe(true);
    expect(hasQualifier("only drinks")).toBe(true);
    expect(hasQualifier("menu")).toBe(false);
  });
  test("the grouped menu names each dish once", () => {
    const digest = menuDigest(catalog, "fb");
    for (const name of ["Samosa", "Pakora", "Mutton Rogan Josh"]) expect(digest.split(name).length - 1).toBeLessThanOrEqual(1);
  });
});

describe("order of checks", () => {
  test("a mispriced real dish is corrected, not removed", () => {
    const out = guardModelReply(verifyReply("- *Pakora* \u20B9130 - crispy and hot", catalog), catalog);
    expect(out).toContain("Pakora");
    expect(out).toContain("\u20B9120");
  });
});

describe("receipts", () => {
  test("a line total is not mistaken for a wrong price", () => {
    const line = "- 2 x Samosa - \u20B9300";
    expect(verifyReply(line, catalog)).toBe(line);
  });
});

describe("reading amounts", () => {
  test("a word ending in rs is not mistaken for rupees", () => {
    const line = "- *Pakora* \u20B9120 - hot fritters, made for exactly this kind of weather";
    expect(guardModelReply(line, catalog)).toBe(line);
  });
});
