import { isAmenityAsk } from "../src/menu/catalog";

describe("amenities belong to housekeeping, not the kitchen", () => {
  test("water, towels and toiletries are amenities", () => {
    for (const t of ["2 bottles of water", "do paani ki bottle", "extra towels", "toothbrush and toothpaste", "one more pillow"]) expect(isAmenityAsk(t)).toBe(true);
  });
  test("food is not", () => {
    for (const t of ["chicken biryani", "2 samosa", "masala chai", "paneer tikka"]) expect(isAmenityAsk(t)).toBe(false);
  });
});
