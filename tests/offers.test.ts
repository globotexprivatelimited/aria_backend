import { chooseOffer, closedDepts, mentions, qtyOf, renderOffer } from "../src/upsell/offers";
import type { Catalog, CatalogItem } from "../src/menu/catalog";
import type { Pairing } from "../src/menu/pairings";

const item = (over: Partial<CatalogItem>): CatalogItem => ({ id: "x", code: "x", dept: "fb", name: "Item", category: null, kind: "food", description: null, urgency: null, seats: 0, unit: null, responseMins: 20, diet: "veg", price: 100, stock: 10, available: true, prepMins: 15, durationMin: 0, signature: false, bestseller: false, ageRestricted: false, servedFrom: null, servedTo: null, ...over } as CatalogItem);
const catalogOf = (items: CatalogItem[]): Catalog => ({ items, byCode: new Map(items.map((i) => [i.code, i])), slots: [], promptText: "", configured: { fb: true, dining: true, spa: false, housekeeping: false, front_desk: false, maintenance: false }, timezone: "Asia/Kolkata", now: new Date() } as unknown as Catalog);
const pairing = (over: Partial<Pairing>): Pairing => ({ itemId: "samosa", itemName: "Samosa", pairsWith: ["Masala chai"], neverSuggest: false, contains: null, updatedAt: "", updatedBy: null, ...over });
const samosa = item({ id: "samosa", code: "samosa", name: "Samosa", price: 120 });
const chai = item({ id: "chai", code: "chai", name: "Masala chai", kind: "drink", price: 150 });
const lobster = item({ id: "lobster", code: "lobster", name: "Lobster thermidor", price: 2400 });

describe("the code picks the offer; the AI only phrases it", () => {
  test("a pairing for what the guest just ordered comes first", () => {
    const c = chooseOffer({ catalog: catalogOf([samosa, chai, lobster]), pairings: [pairing({})], recentNames: ["Samosa"], closed: new Set(), history: new Map() });
    expect(c?.item.name).toBe("Masala chai");
    expect(c?.basis).toBe("pairing");
    expect(renderOffer(c!)).toMatch(/Masala chai at Rs 150 - goes well with the Samosa/);
  });
  test("never for a closed facility, a never-suggest item, a sold-out item, or something already on the table", () => {
    const base = { catalog: catalogOf([samosa, chai]), pairings: [pairing({})], recentNames: ["Samosa"], history: new Map<string, number>() };
    expect(chooseOffer({ ...base, closed: closedDepts([{ name: "Kitchen", status: "closed" }]) })).toBeNull();
    expect(chooseOffer({ ...base, closed: new Set(), pairings: [pairing({}), pairing({ itemId: "chai", itemName: "Masala chai", pairsWith: [], neverSuggest: true })] })).toBeNull();
    expect(chooseOffer({ ...base, closed: new Set(), catalog: catalogOf([samosa, item({ ...chai, available: false })]) })).toBeNull();
    expect(chooseOffer({ ...base, closed: new Set(), exclude: new Set(["chai"]) })).toBeNull();
    expect(chooseOffer({ ...base, closed: new Set(), recentNames: ["Samosa", "Masala chai"] })).toBeNull();
  });
  test("a closed spa silences spa offers but not the kitchen", () => {
    const closed = closedDepts([{ name: "Spa & wellness", status: "closed" }, { name: "Swimming pool", status: "closed" }, { name: "Rooftop restaurant", status: "open" }]);
    expect(closed.has("spa")).toBe(true); expect(closed.has("dining")).toBe(false); expect(closed.has("fb")).toBe(false);
  });
});

describe("the log follows the reply and the order", () => {
  test("did the reply say it, did the order contain it", () => {
    expect(mentions("Your samosas are on the way! A masala chai goes beautifully with them - shall I add one?", "Masala chai")).toBe(true);
    expect(mentions("Your samosas are on the way!", "Masala chai")).toBe(false);
    expect(mentions("Tea is on the way", "Masala chai")).toBe(false);
    expect(mentions("2 x Paneer Tikka, 1 x Masala Chai", "Masala chai")).toBe(true);
  });
  test("quantity, for the revenue", () => {
    expect(qtyOf("2 x Masala chai", "Masala chai")).toBe(2);
    expect(qtyOf("Masala chai x 3", "Masala chai")).toBe(3);
    expect(qtyOf("1 Samosa, 2 Masala chai", "Masala chai")).toBe(2);
    expect(qtyOf("Masala chai", "Masala chai")).toBe(1);
  });
});
