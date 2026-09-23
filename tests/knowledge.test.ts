import { selectFacts, renderKnowledge, type Fact } from "../src/knowledge/service";

const f = (topic: string, content: string, category = "general", keywords = ""): Fact => ({ id: topic, topic, content, category, keywords, active: true, updatedAt: new Date() });
const facts: Fact[] = [
  f("Check-in and check-out", "Check-in from 2 pm, check-out by 11 am.", "essentials", "checkin checkout late early"),
  f("Wi-Fi", "Network on the key card, password at reception.", "essentials", "wifi internet password net"),
  f("Breakfast", "Served 7:30 to 10:30 am in the ground-floor restaurant.", "dining", "breakfast nashta morning"),
  f("Swimming pool", "Open 7 am to 8 pm.", "facilities", "pool swimming swim"),
  ...Array.from({ length: 25 }, (_, i) => f("Other " + i, "Another fact " + i + " " + "x".repeat(220), "general", "")),
];

describe("hotel knowledge", () => {
  test("a short list goes to the brain whole", () => {
    expect(selectFacts(facts.slice(0, 4), "anything").length).toBe(4);
  });
  test("a long list keeps the essentials and the facts the guest's words point to", () => {
    expect(selectFacts(facts, "kal subah nashta kitne baje milega").map((x) => x.topic)).toEqual(["Check-in and check-out", "Wi-Fi", "Breakfast"]);
    expect(selectFacts(facts, "pool hai kya").map((x) => x.topic)).toContain("Swimming pool");
  });
  test("nothing written means nothing claimed", () => {
    expect(renderKnowledge([])).toBe("");
    expect(renderKnowledge(facts.slice(0, 1))).toContain("- Check-in and check-out: Check-in from 2 pm");
  });
});
