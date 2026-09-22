import { keepsTheFacts } from "../src/brain/polish";

describe("the polish pass never changes a fact", () => {
  const booking = "I have reserved Wednesday 23 Sept at 10 am for your Facial (60 min, \u20B9500) - the spa will confirm shortly.";
  test("a natural rewrite with every number kept is accepted", () => {
    expect(keepsTheFacts(booking, "Done - your facial is booked for Wednesday 23 September at 10 am (60 min, \u20B9500). The spa will confirm shortly.")).toBe(true);
  });
  test("a rewrite that drops a number is rejected", () => {
    expect(keepsTheFacts(booking, "Done - your facial is booked for Wednesday at 10 am, \u20B9500.")).toBe(false);
  });
  test("a rewrite that invents a price is rejected", () => {
    expect(keepsTheFacts(booking, "Booked for 23 Sept at 10 am (60 min, \u20B9500) - add a massage for \u20B91000?")).toBe(false);
  });
  test("a Hinglish rewrite keeps the order facts", () => {
    expect(keepsTheFacts("Your order for Room 104:\n- 2 x Samosa - \u20B9300\nTotal \u20B9300.", "Room 104 mein 2 samose aa rahe hain - total \u20B9300.")).toBe(true);
  });
});
