import { needsFactCheck } from "../src/agent/index";

describe("the fact check runs only when there is a fact to check", () => {
  test("acknowledgements skip it, facts get it", () => {
    for (const t of ["On its way!", "Ha, fair point! The Mutton Rogan Josh is your go-to then - shall I send one up?", "No worries! Let me know if you'd like anything else."]) expect(needsFactCheck(t)).toBe(false);
    for (const t of ["The pool is open 7 am to 9 pm.", "Samosa is 150 rupees", "Breakfast is included in your room rate.", "The spa closes at 9 pm."]) expect(needsFactCheck(t)).toBe(true);
  });
});
