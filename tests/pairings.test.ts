import { renderPairings, type Pairing } from "../src/menu/pairings";

const p = (over: Partial<Pairing>): Pairing => ({ itemId: "1", itemName: "Samosa", pairsWith: [], neverSuggest: false, contains: null, updatedAt: "", updatedBy: null, ...over });

describe("menu pairings reach the brain", () => {
  test("goes well with, never suggest, contains", () => {
    const text = renderPairings([p({ pairsWith: ["Masala chai", "Mint chutney"] }), p({ itemId: "2", itemName: "Lobster thermidor", neverSuggest: true }), p({ itemId: "3", itemName: "Paneer tikka", contains: "dairy" })]);
    expect(text).toMatch(/Samosa goes well with: Masala chai, Mint chutney/);
    expect(text).toMatch(/Never suggest unless the guest asks for it by name: Lobster thermidor/);
    expect(text).toMatch(/Contains .*: Paneer tikka - dairy/);
  });
  test("nothing recorded, nothing said", () => { expect(renderPairings([])).toBe(""); expect(renderPairings([p({})])).toBe(""); });
});
