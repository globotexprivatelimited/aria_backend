import { atHotelTime, hotelClock } from "../src/proactive";

describe("proactive messages follow the hotel's clock, never the server's", () => {
  test("18:30 in Burdwan is 13:00 UTC", () => {
    expect(atHotelTime("Asia/Kolkata", "2026-09-23", 18, 30).toISOString()).toBe("2026-09-23T13:00:00.000Z");
  });
  test("18:30 in New York is 22:30 UTC", () => {
    expect(atHotelTime("America/New_York", "2026-09-23", 18, 30).toISOString()).toBe("2026-09-23T22:30:00.000Z");
  });
  test("18:30 UTC reads as midnight in Burdwan - the bug that woke a guest", () => {
    const c = hotelClock("Asia/Kolkata", new Date("2026-09-22T18:30:00Z"));
    expect(c.date).toBe("2026-09-23");
    expect(c.minutes).toBe(0);
  });
});
