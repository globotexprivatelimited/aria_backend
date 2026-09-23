import { looksLikeFeedback } from "../src/proactive";

describe("only feedback is treated as feedback", () => {
  test("greetings, thanks, questions and requests are not", () => {
    for (const t of ["Hii", "hello", "thank you", "kya spa open hai?", "How do I book a room", "pls send 2 samosa", "Can I get a late checkout"]) expect(looksLikeFeedback(t)).toBe(false);
  });
  test("an opinion about the stay is", () => {
    for (const t of ["Stay was great, staff very helpful", "Room was dirty and the AC did not work", "Hi, everything was lovely except the breakfast was cold"]) expect(looksLikeFeedback(t)).toBe(true);
  });
});
