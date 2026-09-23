import { looksLikeOrderCancellation } from "../src/menu/orders";

describe("a cancellation is recognised for what it is", () => {
  test("cancelling or cutting down an order", () => {
    expect(looksLikeOrderCancellation("Guest wants to cancel one of the two Samosa plates just ordered - reduce to 1 plate of Samosa only.")).toBe(true);
    expect(looksLikeOrderCancellation("Guest does not want the food anymore")).toBe(true);
  });
  test("other asks are left alone", () => {
    expect(looksLikeOrderCancellation("Guest wants 2 extra towels")).toBe(false);
    expect(looksLikeOrderCancellation("Cancel my spa booking please")).toBe(false);
  });
});
