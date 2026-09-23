import type * as Meta from "../src/lib/meta";

describe("every send records what Meta actually said", () => {
  let meta: typeof Meta;
  const sent: any[] = [];
  let next = { status: 200, body: "" };
  const realFetch = globalThis.fetch;
  beforeAll(() => {
    process.env.META_ACCESS_TOKEN = "test-token";
    process.env.META_PHONE_NUMBER_ID = "123";
    (globalThis as any).fetch = async (_url: string, init: any) => { sent.push(JSON.parse(init.body)); return { ok: next.status < 300, status: next.status, text: async () => next.body }; };
    jest.isolateModules(() => { meta = require("../src/lib/meta"); });
  });
  afterAll(() => { (globalThis as any).fetch = realFetch; });

  test("an accepted message keeps Meta's message id", async () => {
    next = { status: 200, body: JSON.stringify({ messages: [{ id: "wamid.ABC" }] }) };
    expect(await meta.sendText("+91 90380 12530", "hi")).toEqual({ ok: true, id: "wamid.ABC", error: null });
    expect(sent[0].to).toBe("919038012530");
  });
  test("a refused message keeps Meta's code and reason", async () => {
    next = { status: 400, body: JSON.stringify({ error: { code: 132001, message: "Template name does not exist", error_data: { details: "template name (aria_feedback) does not exist in en" } } }) };
    const r = await meta.sendTemplate("+919038012530", "aria_feedback", ["Rahul", "Sunanda Hotel"]);
    expect(r.ok).toBe(false);
    expect(r.error).toContain("132001");
  });
  test("template parameters are cleaned so Meta cannot refuse them", async () => {
    next = { status: 200, body: JSON.stringify({ messages: [{ id: "wamid.T" }] }) };
    await meta.sendTemplate("+919038012530", "aria_feedback", ["Rahul\nKumar", ""]);
    expect(sent[sent.length - 1].template.components[0].parameters).toEqual([{ type: "text", text: "Rahul Kumar" }, { type: "text", text: "-" }]);
  });
});
