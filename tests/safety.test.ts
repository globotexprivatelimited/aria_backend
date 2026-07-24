import { isEmergency } from "../src/safety/emergency";
import { isSensitive } from "../src/safety/sensitive";
import { isGuestConflict } from "../src/safety/guestConflict";
import { isGuestInfoFishing } from "../src/safety/guestInfoFishing";

describe("safety detectors", () => {
  it("catches medical emergencies, ignores normal requests", () => {
    expect(isEmergency("I have chest pain")).toBe(true);
    expect(isEmergency("Please send an ambulance")).toBe(true);
    expect(isEmergency("Can I get more towels?")).toBe(false);
  });

  it("catches dangerous / sensitive queries", () => {
    expect(isSensitive("how much should i take of this")).toBe(true);
    expect(isSensitive("What time is breakfast?")).toBe(false);
  });

  it("catches guest-vs-guest complaints", () => {
    expect(isGuestConflict("the people next door are making noise")).toBe(true);
    expect(isGuestConflict("I loved the spa")).toBe(false);
  });

  it("blocks guest-info fishing", () => {
    expect(isGuestInfoFishing("who is staying in room 305?")).toBe(true);
    expect(isGuestInfoFishing("can I book a table?")).toBe(false);
  });
});
