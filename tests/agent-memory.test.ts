import { isNearDuplicate } from "../src/agent/tools";

describe("nothing is done twice", () => {
  test("the same complaint in different words is a duplicate", () => {
    expect(isNearDuplicate("Maintenance (Electrical): Guest in room 104 says AC is not cooling properly.", "AC in room 104 is not cooling properly. Guest is uncomfortable.")).toBe(true);
  });
  test("the same order again is a duplicate", () => {
    expect(isNearDuplicate("Room service order: 2 x Samosa, 1 x Pakora (total \u20B9420)", "Room service order: 2 x Samosa, 1 x Pakora")).toBe(true);
  });
  test("a different ask to the same team is not", () => {
    expect(isNearDuplicate("Housekeeping: 2 x Towel", "2 pillows please for room 104")).toBe(false);
  });
});
