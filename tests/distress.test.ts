import { looksLikeDistress } from "../src/safety/distress";

describe("a guest in distress is recognised without the AI", () => {
  test("English, Hindi and Bengali phrasings", () => {
    for (const t of ["I don't want to be alive anymore", "i want to die", "mujhe jeena nahi chahiye", "main marna chahta hoon", "ami banchte chai na", "\u092E\u0930\u0928\u093E \u091A\u093E\u0939\u0924\u093E \u0939\u0942\u0902", "\u09AE\u09B0\u09C7 \u09AF\u09C7\u09A4\u09C7 \u099A\u09BE\u0987", "I took all the pills"]) expect(looksLikeDistress(t)).toBe(true);
  });
  test("ordinary talk is left alone", () => {
    for (const t of ["dying to try the biryani", "this heat is killing me", "I need beer", "kill some time before dinner", "took my pills, need water"]) expect(looksLikeDistress(t)).toBe(false);
  });
});
