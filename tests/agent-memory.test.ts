import { isNearDuplicate } from "../src/agent/tools";

describe("nothing is done twice - and different asks stay different", () => {
  test("the same complaint in different words is a duplicate", () => {
    expect(isNearDuplicate("Maintenance (Electrical): Guest in room 104 says AC is not cooling properly.", "AC in room 104 is not cooling properly. Guest is uncomfortable.")).toBe(true);
    expect(isNearDuplicate("2 towels for room 104", "2 towels room 104 please")).toBe(true);
    expect(isNearDuplicate("Guest wants the room cleaned", "Please clean room 104 today")).toBe(true);
  });
  test("the same order again is a duplicate", () => {
    expect(isNearDuplicate("Room service order: 2 x Samosa, 1 x Pakora (total \u20B9420)", "Room service order: 2 x Samosa, 1 x Pakora")).toBe(true);
  });
  test("four different asks to the same team are four requests", () => {
    expect(isNearDuplicate("2 towels for room 104", "2 pillows for room 104")).toBe(false);
    expect(isNearDuplicate("TV not working in room 104", "AC not working in room 104")).toBe(false);
    expect(isNearDuplicate("Guest needs 2 bottles of water", "Guest needs a toothbrush and toothpaste")).toBe(false);
    expect(isNearDuplicate("Housekeeping: 2 x Towel", "2 pillows please for room 104")).toBe(false);
  });
});
