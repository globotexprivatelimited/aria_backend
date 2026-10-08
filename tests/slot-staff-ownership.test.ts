// No database: the services' queries are answered here and every write they make is recorded.
const mockDb = { slots: new Set<string>(), bookings: new Set<string>(), staff: new Set<string>(), writes: [] as string[] };
jest.mock("../src/db", () => ({
  prisma: {
    $queryRawUnsafe: async (sql: string, ...args: unknown[]) => {
      const key = String(args[0]) + "@" + String(args[1]);
      if (/from time_slots/.test(sql) && /hotel_id/.test(sql)) return mockDb.slots.has(key) ? [{ one: 1 }] : [];
      if (/from slot_bookings/.test(sql) && /hotel_id/.test(sql)) return mockDb.bookings.has(key) ? [{ one: 1 }] : [];
      if (/from staff_users/.test(sql) && /hotel_id/.test(sql)) return mockDb.staff.has(key) ? [{ one: 1 }] : [];
      if (/from staff_users/.test(sql)) return [{ one: 1 }];
      return [];
    },
    $executeRawUnsafe: async (sql: string) => { if (/^\s*(update|insert|delete)\b/i.test(sql)) mockDb.writes.push(sql.trim().split(/\s+/).slice(0, 3).join(" ")); return 1; },
  },
}));

import { updateSlot, deleteSlot, cancelBooking } from "../src/slots/service";
import { setStaffDeptAccess } from "../src/staffaccess/service";

beforeEach(() => { mockDb.slots.clear(); mockDb.bookings.clear(); mockDb.staff.clear(); mockDb.writes.length = 0; });

describe("a record changed by its id must belong to the caller's hotel (item 11)", () => {
  test("hotel B cannot change or remove hotel A's slot; hotel A can", async () => {
    mockDb.slots.add("slot-1@A");
    expect((await updateSlot("slot-1", { capacity: 4, label: "Late" }, "B")).ok).toBe(false);
    expect((await deleteSlot("slot-1", "B")).ok).toBe(false);
    expect(mockDb.writes).toEqual([]);
    expect((await updateSlot("slot-1", { capacity: 4, label: "Late" }, "A")).ok).toBe(true);
    expect((await deleteSlot("slot-1", "A")).ok).toBe(true);
    expect(mockDb.writes).toEqual(["update time_slots set", "update time_slots set", "delete from time_slots"]);
  });
  test("hotel B cannot cancel hotel A's booking; hotel A can", async () => {
    mockDb.bookings.add("bk-7@A");
    expect((await cancelBooking("bk-7", "B")).ok).toBe(false);
    expect(mockDb.writes).toEqual([]);
    expect((await cancelBooking("bk-7", "A")).ok).toBe(true);
    expect(mockDb.writes).toEqual(["update slot_bookings set"]);
  });
  test("an id that is no slot at all is refused plainly, with no write", async () => {
    expect(await updateSlot("not-an-id", { capacity: 2 }, "A")).toEqual({ ok: false, error: expect.stringMatching(/this hotel/) });
    expect(await deleteSlot("", "A")).toEqual({ ok: false, error: expect.stringMatching(/this hotel/) });
    expect(mockDb.writes).toEqual([]);
  });
  test("a GM changes department access only for their own hotel's staff", async () => {
    mockDb.staff.add("staff-9@A");
    expect(await setStaffDeptAccess("B", "staff-9", "spa", true)).toEqual({ ok: false, error: "Staff member not found for this hotel." });
    expect(await setStaffDeptAccess("", "staff-9", "spa", true)).toEqual({ ok: false, error: "Staff member not found for this hotel." });
    expect(mockDb.writes).toEqual([]);
    expect((await setStaffDeptAccess("A", "staff-9", "spa", true)).ok).toBe(true);
    expect(mockDb.writes).toEqual(["update staff_departments set"]);
  });
});
