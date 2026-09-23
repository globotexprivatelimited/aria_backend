import { isTestNumber, isTestHotel } from "../src/lib/testguard";

describe("test guests stay out of live hotels", () => {
  test("+999 numbers are test numbers, real ones are not", () => {
    expect(isTestNumber("+9991000000112")).toBe(true);
    expect(isTestNumber("+919038012530")).toBe(false);
    expect(isTestNumber("9991234567")).toBe(false);
    expect(isTestNumber(undefined)).toBe(false);
  });
  test("only the Test Hotel takes them by default", () => {
    delete process.env.TEST_HOTEL_IDS;
    expect(isTestHotel("18")).toBe(true);
    expect(isTestHotel("16")).toBe(false);
  });
});
