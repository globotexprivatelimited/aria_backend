import { inWindow, quietEndsTomorrow, minutesOf, hhmm, checkHours, DEFAULT_HOURS, renderDeptHours, deptOpenNow, type DeptHours } from "../src/settings/service";

const dh = (over: Partial<DeptHours>): DeptHours => ({ id: "1", dept: "fb", label: "Room service (kitchen)", openTime: "07:00", closeTime: "23:00", weekendOpenTime: null, weekendCloseTime: null, closedDays: [], outOfHours: null, active: true, updatedAt: "", updatedBy: null, ...over });

describe("quiet hours and the nudge window are windows on the hotel's clock", () => {
  test("a window that crosses midnight", () => {
    expect(inWindow(22 * 60, DEFAULT_HOURS.quietFrom, DEFAULT_HOURS.quietTo)).toBe(true);
    expect(inWindow(3 * 60, DEFAULT_HOURS.quietFrom, DEFAULT_HOURS.quietTo)).toBe(true);
    expect(inWindow(9 * 60, DEFAULT_HOURS.quietFrom, DEFAULT_HOURS.quietTo)).toBe(false);
    expect(inWindow(21 * 60 + 29, DEFAULT_HOURS.quietFrom, DEFAULT_HOURS.quietTo)).toBe(false);
  });
  test("a window inside one day, and an empty one", () => {
    expect(inWindow(18 * 60, 17 * 60, 21 * 60)).toBe(true);
    expect(inWindow(21 * 60, 17 * 60, 21 * 60)).toBe(false);
    expect(inWindow(0, 0, 6 * 60)).toBe(true);
    expect(inWindow(12 * 60, 0, 6 * 60)).toBe(false);
    expect(inWindow(12 * 60, 12 * 60, 12 * 60)).toBe(false);
  });
  test("a message held at night waits for tomorrow morning; one held at dawn waits for today", () => {
    expect(quietEndsTomorrow(23 * 60, DEFAULT_HOURS)).toBe(true);
    expect(quietEndsTomorrow(5 * 60, DEFAULT_HOURS)).toBe(false);
    expect(quietEndsTomorrow(2 * 60, { ...DEFAULT_HOURS, quietFrom: 0, quietTo: 6 * 60 })).toBe(false);
  });
  test("times parse and print", () => {
    expect(minutesOf("21:30")).toBe(21 * 60 + 30); expect(minutesOf("8:05")).toBe(485); expect(minutesOf("24:00")).toBeNull(); expect(minutesOf("evening")).toBeNull();
    expect(hhmm(485)).toBe("08:05"); expect(hhmm(1290)).toBe("21:30");
  });
  test("bad settings are refused with a reason", () => {
    expect(checkHours(DEFAULT_HOURS, { quietFrom: "late" })).toEqual({ ok: false, error: "quietFrom must be HH:MM (24-hour)" });
    expect(checkHours(DEFAULT_HOURS, { nudgeFrom: "18:00", nudgeTo: "18:00" }).ok).toBe(false);
    expect(checkHours(DEFAULT_HOURS, { nudgeFrom: "23:00", nudgeTo: "01:00" }).ok).toBe(false);
    expect(checkHours(DEFAULT_HOURS, { offersPerDay: 99 }).ok).toBe(false);
    const ok = checkHours(DEFAULT_HOURS, { quietFrom: "22:00", quietTo: "07:00", nudgeFrom: "18:00", nudgeTo: "20:30", offersPerDay: 1, offerGapHours: 6 });
    expect(ok.ok && ok.hours.quietFrom).toBe(22 * 60);
    expect(ok.ok && ok.hours.offersPerDay).toBe(1);
  });
});

describe("department hours reach the brain with OPEN or CLOSED now", () => {
  test("open, closed, weekend override, closed day, no hours", () => {
    const fb = dh({});
    expect(deptOpenNow(fb, 8 * 60, "Tue")).toBe(true);
    expect(deptOpenNow(fb, 23 * 60 + 30, "Tue")).toBe(false);
    expect(deptOpenNow(dh({ weekendOpenTime: "08:00", weekendCloseTime: "22:00" }), 7 * 60 + 30, "Sun")).toBe(false);
    expect(deptOpenNow(dh({ closedDays: ["Mon"] }), 12 * 60, "Mon")).toBe(false);
    expect(deptOpenNow(dh({ openTime: null, closeTime: null }), 3 * 60, "Mon")).toBeNull();
  });
  test("the rendered block", () => {
    const text = renderDeptHours([dh({}), dh({ id: "2", dept: "spa", label: "Spa", openTime: "09:00", closeTime: "20:00", closedDays: ["Mon"], outOfHours: "say it opens at 09:00 and offer to book for then" })], 21 * 60, "Mon");
    expect(text).toMatch(/now 21:00 Mon/);
    expect(text).toMatch(/Room service \(kitchen\): 07:00-23:00 - OPEN now/);
    expect(text).toMatch(/Spa: 09:00-20:00, closed Mon - CLOSED now \(say it opens at 09:00/);
    expect(renderDeptHours([], 600, "Tue")).toBe("");
  });
});
