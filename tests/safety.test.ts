import { isEmergency } from "../src/safety/emergency";
import { isSensitive } from "../src/safety/sensitive";
import { isGuestConflict } from "../src/safety/guestConflict";
import { isGuestInfoFishing } from "../src/safety/guestInfoFishing";

describe("safety detectors", () => {
  it("catches medical emergencies, ignores normal requests", () => {
    expect(isEmergency("I have chest pain")).toBe(true);
    expect(isEmergency("Please send an ambulance")).toBe(true);
    expect(isEmergency("Can I get more towels?")).toBe(false);
    expect(isEmergency("I would like a non-smoking room")).toBe(false);
  });

  it("catches fire, gas and smoke hazards (D-056)", () => {
    expect(isEmergency("there is a fire in my room")).toBe(true);
    expect(isEmergency("there is a strong smell of gas in my bathroom")).toBe(true);
    expect(isEmergency("I can smell something burning")).toBe(true);
    expect(isEmergency("smoke is coming from the AC")).toBe(true);
  });

  it("catches emergencies in Hindi and Bengali (D-057)", () => {
    // Hinglish
    expect(isEmergency("mere kamre me aag lagi hai madad karo")).toBe(true);
    expect(isEmergency("meri wife behosh ho gayi hai")).toBe(true);
    // Devanagari: "mere kamre mein aag lagi hai" and "mujhe saans nahi aa rahi"
    expect(isEmergency("\u092e\u0947\u0930\u0947 \u0915\u092e\u0930\u0947 \u092e\u0947\u0902 \u0906\u0917 \u0932\u0917\u0940 \u0939\u0948")).toBe(true);
    expect(isEmergency("\u092e\u0941\u091d\u0947 \u0938\u093e\u0902\u0938 \u0928\u0939\u0940\u0902 \u0906 \u0930\u0939\u0940")).toBe(true);
    // Bengali: "amar ghore agun legeche"
    expect(isEmergency("\u0986\u09ae\u09be\u09b0 \u0998\u09b0\u09c7 \u0986\u0997\u09c1\u09a8 \u09b2\u09c7\u0997\u09c7\u099b\u09c7")).toBe(true);
    // ordinary Hindi request is not an emergency: "kripya do tauliye bhejen" (please send two towels)
    expect(isEmergency("\u0915\u0943\u092a\u092f\u093e \u0926\u094b \u0924\u094c\u0932\u093f\u092f\u0947 \u092d\u0947\u091c\u0947\u0902")).toBe(false);
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
