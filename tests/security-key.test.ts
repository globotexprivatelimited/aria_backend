import { isAdminKey, safeEqual } from "../src/lib/security";

describe("the admin key is compared safely and can be rotated", () => {
  const saved = { cur: process.env.ADMIN_API_KEY, prev: process.env.ADMIN_API_KEY_PREVIOUS };
  afterAll(() => { process.env.ADMIN_API_KEY = saved.cur; if (saved.prev === undefined) delete process.env.ADMIN_API_KEY_PREVIOUS; else process.env.ADMIN_API_KEY_PREVIOUS = saved.prev; });
  test("only the exact key passes", () => {
    process.env.ADMIN_API_KEY = "new-key-123"; delete process.env.ADMIN_API_KEY_PREVIOUS;
    expect(isAdminKey("new-key-123")).toBe(true);
    for (const bad of ["new-key-12", "new-key-1234", "", undefined, null, "NEW-KEY-123"]) expect(isAdminKey(bad)).toBe(false);
    expect(safeEqual("a", "a")).toBe(true); expect(safeEqual("a", "b")).toBe(false);
  });
  test("during a rotation the previous key still works, until it is removed", () => {
    process.env.ADMIN_API_KEY = "new-key-123"; process.env.ADMIN_API_KEY_PREVIOUS = "old-key-999";
    expect(isAdminKey("old-key-999")).toBe(true);
    delete process.env.ADMIN_API_KEY_PREVIOUS;
    expect(isAdminKey("old-key-999")).toBe(false);
  });
});
