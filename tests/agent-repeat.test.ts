import { repeatsEarlier } from "../src/agent/index";

type Turn = { role: "user" | "assistant"; content: string };
const prior = "Order ho gaya - 2 Samosa (300) + 1 Pakora (120), total 420, kitchen mein hai. Kuch aur chahiye?";

describe("Aria says each thing once", () => {
  test("a near-identical reply is caught", () => {
    const h: Turn[] = [{ role: "user", content: "2 samosa" }, { role: "assistant", content: prior }];
    expect(repeatsEarlier("Order ho gaya! 2 Samosa (300) + 1 Pakora (120), total 420, kitchen mein hai. Kuch aur chahiye?", h)).toBe(prior);
  });
  test("a different reply, or a short one, is not", () => {
    const h: Turn[] = [{ role: "assistant", content: prior }];
    expect(repeatsEarlier("Samosa raaste mein hai, 10 minute.", h)).toBeNull();
    expect(repeatsEarlier("Ji, theek hai.", [{ role: "assistant", content: "Ji, theek hai." }])).toBeNull();
  });
  test("only the last three replies count", () => {
    const h: Turn[] = [{ role: "assistant", content: prior }, ...[1, 2, 3].map((i) => ({ role: "assistant" as const, content: "Message number " + i + " about something else entirely, with unrelated words here." }))];
    expect(repeatsEarlier(prior, h)).toBeNull();
  });
});
