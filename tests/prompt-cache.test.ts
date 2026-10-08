jest.mock("../src/db", () => ({ prisma: {} }));
import { systemPromptParts, buildSystemPrompt, systemBlocks, promptCacheTtl } from "../src/brain/prompt";
import { costUsd } from "../src/lib/aiUsage";

const hotel = { name: "Testhotel Quillon", timezone: "Europe/Lisbon" } as never;
const menu = "IN-ROOM DINING MENU (code | name | category | diet | price | notes)\nF1 | Zanzibar Chai | Beverages | veg | Rs 120 | -";
const at = (hour: string) => "NOW AT THE HOTEL: Thursday afternoon (" + hour + ":00 local), monsoon, rainy. Let this shape what you suggest.\n\n" + menu;
const modes = { fb: "auto", spa: "approve" } as never;
const guestA = { roomNumber: "9417", claimedGuestName: "Zoravar Qeel", roomVerified: true } as never;
const guestB = { roomNumber: "9311", claimedGuestName: "Ottoline Vex", roomVerified: false } as never;

describe("the brain's prompt is split so Claude can cache the hotel's part (item 18)", () => {
  test("two guests of one hotel, at different hours, with different knowledge and offers, share the hotel's part word for word", () => {
    const a = systemPromptParts(hotel, guestA, modes, at("14"), "Quokka spa offer", "Marmoset pool fact");
    const b = systemPromptParts(hotel, guestB, modes, at("15"), undefined, "Wombat weather line");
    expect(a.stable).toBe(b.stable);
    for (const s of ["Testhotel Quillon", "Zanzibar Chai", "you MAY confirm"]) expect(a.stable).toContain(s);
    for (const s of ["Zoravar Qeel", "9417", "14:00 local", "Quokka spa offer", "Marmoset pool fact", "Europe/Lisbon"]) expect(a.stable).not.toContain(s);
    for (const s of ["Zoravar Qeel", "9417", "Room verified by front desk: yes", "NOW AT THE HOTEL: Thursday afternoon (14:00 local)", "PENDING OFFER: Quokka spa offer", "Marmoset pool fact", "Europe/Lisbon"]) expect(a.variable).toContain(s);
    expect(a.variable.trim().endsWith("Call the respond tool exactly once.")).toBe(true);
  });
  test("the whole prompt is the hotel's part then the guest's part - nothing lost", () => {
    const p = systemPromptParts(hotel, guestA, modes, at("09"), "Quokka spa offer", "Marmoset pool fact");
    expect(buildSystemPrompt(hotel, guestA, modes, at("09"), "Quokka spa offer", "Marmoset pool fact")).toBe(p.stable + "\n" + p.variable);
  });
  test("a menu without the hour line, and a hotel with no menu, are left as they were", () => {
    expect(systemPromptParts(hotel, guestA, undefined, menu).stable).toContain("Zanzibar Chai");
    expect(systemPromptParts(hotel, guestA).stable).toContain("MENU: this hotel has not published one");
  });
  test("Claude gets the hotel's part marked for a 1-hour cache, then the guest's part; ARIA_PROMPT_CACHE=5m or off changes only the mark", () => {
    const parts = { stable: "S", variable: "V" };
    expect(systemBlocks(parts, "1h")).toEqual([{ type: "text", text: "S", cache_control: { type: "ephemeral", ttl: "1h" } }, { type: "text", text: "V" }]);
    expect(systemBlocks(parts, "5m")[0].cache_control).toEqual({ type: "ephemeral" });
    expect(systemBlocks(parts, null)[0].cache_control).toBeUndefined();
    const was = process.env.ARIA_PROMPT_CACHE;
    try {
      delete process.env.ARIA_PROMPT_CACHE; expect(promptCacheTtl()).toBe("1h");
      process.env.ARIA_PROMPT_CACHE = "5m"; expect(promptCacheTtl()).toBe("5m");
      process.env.ARIA_PROMPT_CACHE = "off"; expect(promptCacheTtl()).toBeNull();
    } finally { if (was === undefined) delete process.env.ARIA_PROMPT_CACHE; else process.env.ARIA_PROMPT_CACHE = was; }
  });
  test("a 1-hour cache write is priced at 2x input, a 5-minute one at 1.25x, a read at 0.1x", () => {
    expect(costUsd("claude-sonnet-4-6", { input_tokens: 100, output_tokens: 10, cache_creation_input_tokens: 3000, cache_creation: { ephemeral_1h_input_tokens: 3000, ephemeral_5m_input_tokens: 0 } })).toBeCloseTo(0.01845, 9);
    expect(costUsd("claude-sonnet-4-6", { input_tokens: 100, output_tokens: 10, cache_creation_input_tokens: 3000 })).toBeCloseTo(0.0117, 9);
    expect(costUsd("claude-sonnet-4-6", { input_tokens: 100, output_tokens: 10, cache_read_input_tokens: 3000 })).toBeCloseTo(0.00135, 9);
  });
});
