import { isTrivialMessage, trivialReply } from "../src/webhooks/inbound";
import { isCancelIntent } from "../src/menu/catalog";
import { detailSimilarity } from "../src/executor";
import { deptType, validActions, acknowledgementFor } from "../src/executor/departmentModel";
import { departmentFor, isBooking } from "../src/executor/routing";

describe("trivial-message short-circuit (D-034 / D-033)", () => {
  it("treats acknowledgements, punctuation and emoji as having no request", () => {
    expect(isTrivialMessage("...")).toBe(true);
    expect(isTrivialMessage("ok")).toBe(true);
    expect(isTrivialMessage("Thank you!")).toBe(true);
    expect(isTrivialMessage("👍👍")).toBe(true); // thumbs up x2
    expect(isTrivialMessage("theek hai")).toBe(true);
  });
  it("never swallows a real request", () => {
    expect(isTrivialMessage("ok send two towels")).toBe(false);
    expect(isTrivialMessage("2")).toBe(false);
    expect(isTrivialMessage("yes")).toBe(false);
    expect(isTrivialMessage("my AC is broken")).toBe(false);
  });
  it("thanks a guest who said thanks", () => {
    expect(trivialReply("thanks a lot")).toMatch(/pleasure/i);
    expect(trivialReply("...")).toMatch(/say the word|here whenever/i);
  });
});

describe("cancel intent never places an order (D-055)", () => {
  it("detects cancel in English, Hinglish, Hindi and Bengali", () => {
    expect(isCancelIntent("please cancel my spa booking")).toBe(true);
    expect(isCancelIntent("order cancel karo")).toBe(true);
    expect(isCancelIntent("\u092e\u0947\u0930\u093e \u0911\u0930\u094d\u0921\u0930 \u0930\u0926\u094d\u0926 \u0915\u0930\u094b")).toBe(true); // mera order radd karo
    expect(isCancelIntent("\u0986\u09ae\u09be\u09b0 \u09ac\u09c1\u0995\u09bf\u0982 \u09ac\u09be\u09a4\u09bf\u09b2 \u0995\u09b0\u09c1\u09a8")).toBe(true); // amar booking batil korun
  });
  it("does not fire on ordinary orders", () => {
    expect(isCancelIntent("one mutton rogan josh please")).toBe(false);
    expect(isCancelIntent("yes")).toBe(false);
  });
});

describe("request de-duplication similarity (D-033 / D-046)", () => {
  it("sees the same ask worded two ways as a duplicate", () => {
    expect(detailSimilarity("Guest requests 2 towels delivered to room 702", "Guest wants two towels delivered to room 702")).toBeGreaterThanOrEqual(0.5);
    expect(detailSimilarity("I need 2 towels please", "I need 2 towels please")).toBe(1);
  });
  it("keeps genuinely different asks apart", () => {
    expect(detailSimilarity("Two towels to room 702", "Bottle of water to room 702")).toBeLessThan(0.5);
    expect(detailSimilarity("AC not cooling", "TV remote broken")).toBeLessThan(0.5);
  });
});

describe("department model honours per-hotel overrides (D-017)", () => {
  it("falls back to product defaults without a hotel", () => {
    expect(deptType("fb")).toBe("auto");
    expect(deptType("spa")).toBe("accept_decline");
    expect(deptType("maintenance")).toBe("maintenance");
  });
  it("accepts a hotelId on the helper functions", () => {
    expect(validActions("spa", "16")).toEqual(["ACCEPT", "DECLINE", "ALTERNATIVE"]);
    expect(validActions("fb", "16")).toEqual(["CLAIM", "DONE", "PROBLEM"]);
    expect(acknowledgementFor("fb", "order", "16")).toMatch(/on its way/i);
  });
  it("routes intents to the owning department", () => {
    expect(departmentFor("room_service")).toBe("fb");
    expect(departmentFor("concierge")).toBe("front_desk");
    expect(isBooking("spa")).toBe(true);
    expect(isBooking("housekeeping")).toBe(false);
  });
});
