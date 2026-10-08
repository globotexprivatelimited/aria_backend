// No database and no Anthropic: the client answers here, and every statement the recorder runs is kept.
const mockDb = { sql: [] as { sql: string; args: unknown[] }[], fail: false };
jest.mock("../src/db", () => ({
  prisma: {
    $executeRawUnsafe: async (sql: string, ...args: unknown[]) => { if (mockDb.fail) throw new Error("db down"); mockDb.sql.push({ sql, args }); return 1; },
    $queryRawUnsafe: async () => [],
  },
}));
jest.mock("@anthropic-ai/sdk", () => {
  class FakeAnthropic {
    messages = { create: async (body: { model: string }) => ({ id: "msg-1", model: body.model, content: [{ type: "text", text: "Hello" }], usage: { input_tokens: 1000, output_tokens: 500, cache_read_input_tokens: 2000, cache_creation_input_tokens: 100 } }) };
    constructor(_options?: unknown) { void _options; }
  }
  return { __esModule: true, default: FakeAnthropic };
});

import { meteredClaude, costUsd, priceFor, usageScope, usageForHotel } from "../src/lib/aiUsage";

const ask = { model: "claude-sonnet-4-6", max_tokens: 50, messages: [{ role: "user", content: "Is the pool open?" }] };
const inserts = (): unknown[][] => mockDb.sql.filter((q) => /insert into ai_usage/.test(q.sql)).map((q) => q.args);
const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 30));
beforeEach(() => { mockDb.sql.length = 0; mockDb.fail = false; });

describe("what each Claude call costs (item 18)", () => {
  test("prices come from the published table, dated model ids included", () => {
    expect(costUsd("claude-sonnet-4-6", { input_tokens: 1000, output_tokens: 500, cache_read_input_tokens: 2000, cache_creation_input_tokens: 100 })).toBeCloseTo(0.011475, 9);
    expect(costUsd("claude-haiku-4-5-20251001", { input_tokens: 1_000_000, output_tokens: 1_000_000 })).toBeCloseTo(6, 9);
    expect(priceFor("claude-unknown-9")).toBeNull();
    expect(costUsd("claude-unknown-9", { input_tokens: 10 })).toBeNull();
  });
  test("a call is recorded with its hotel, purpose, model, tokens and cost - and the caller gets Claude's reply untouched", async () => {
    const client = meteredClaude("brain");
    const reply = await new Promise<unknown>((resolve) => usageScope({ query: { hotelId: "A" }, body: {} } as never, {} as never, () => { resolve(client.messages.create(ask as never)); }));
    expect((reply as { id: string }).id).toBe("msg-1");
    await settle();
    expect(inserts()).toEqual([["A", "brain", "claude-sonnet-4-6", 1000, 500, 100, 2000, expect.closeTo(0.011475, 9)]]);
  });
  test("work tagged with usageForHotel is charged to that hotel; untagged work to none", async () => {
    const client = meteredClaude("agent");
    await client.messages.create(ask as never);
    await (async () => { usageForHotel("B"); await client.messages.create(ask as never); })();
    await settle();
    expect(inserts().map((a) => a[0])).toEqual([null, "B"]);
  });
  test("a database that cannot record never breaks the reply", async () => {
    mockDb.fail = true;
    const reply = await meteredClaude("polish").messages.create(ask as never);
    expect((reply as { id: string }).id).toBe("msg-1");
    await settle();
  });
});
