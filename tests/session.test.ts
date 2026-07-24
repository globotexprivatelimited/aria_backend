import { looksLikeRoomNumber, isEvasive, canDoRevenueAction } from "../src/session";

describe("session helpers", () => {
  it("recognises a room-number message", () => {
    expect(looksLikeRoomNumber("412")).toBe(true);
    expect(looksLikeRoomNumber("Room 305")).toBe(true);
    expect(looksLikeRoomNumber("can I get towels")).toBe(false);
  });

  it("flags evasive name answers", () => {
    expect(isEvasive("why do you need it")).toBe(true);
    expect(isEvasive("305")).toBe(true);
    expect(isEvasive("Mahasin Khan")).toBe(false);
  });

  it("gates revenue actions to active sessions only", () => {
    expect(canDoRevenueAction({ state: "active" })).toBe(true);
    expect(canDoRevenueAction({ state: "prospect" })).toBe(false);
    expect(canDoRevenueAction({ state: "flagged" })).toBe(false);
  });
});
