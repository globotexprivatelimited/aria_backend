import { effectiveStatus, renderFacilities, checkFacility, hotelToday, type Facility } from "../src/facilities/service";

const f = (over: Partial<Facility>): Facility => ({ id: "1", name: "Swimming pool", status: "open", closedUntil: null, closureNote: null, openTime: "07:00", closeTime: "21:00", weekendOpenTime: null, weekendCloseTime: null, location: "Rooftop", price: "Free for guests", notes: null, active: true, sortOrder: 0, updatedAt: "", updatedBy: null, ...over });

describe("facilities with a live status", () => {
  test("a closure ends on its date; a same-day closure overrides the hours", () => {
    expect(effectiveStatus(f({ status: "closed", closedUntil: "2026-10-12" }), "2026-10-10")).toBe("closed");
    expect(effectiveStatus(f({ status: "closed", closedUntil: "2026-10-12" }), "2026-10-13")).toBe("open");
    expect(effectiveStatus(f({ status: "closed", closedUntil: null }), "2026-10-10")).toBe("closed");
  });
  test("the brain is told plainly, weekend hours included", () => {
    const text = renderFacilities([f({ status: "closed", closedUntil: "2026-10-12", closureNote: "maintenance" }), f({ id: "2", name: "Gym", openTime: "06:00", closeTime: "22:00", weekendOpenTime: "07:00", weekendCloseTime: "21:00", location: "2nd floor" })], "2026-10-10", true);
    expect(text).toMatch(/Swimming pool: CLOSED until 12 Oct \(maintenance\)/);
    expect(text).toMatch(/never suggest or book a closed one/);
    expect(text).toMatch(/Gym: open 07:00-21:00 today \(weekend hours\)/);
    expect(renderFacilities([], "2026-10-10", false)).toBe("");
  });
  test("bad input is refused with a reason", () => {
    expect(checkFacility({ name: "" }, true)).toBe("name required");
    expect(checkFacility({ name: "Spa", openTime: "9am" }, true)).toMatch(/HH:MM/);
    expect(checkFacility({ status: "shut" as never }, false)).toMatch(/open, closed or limited/);
    expect(checkFacility({ name: "Spa", closedUntil: "2026-10-12", status: "closed" }, true)).toBeNull();
  });
  test("today is the hotel's today", () => {
    const t = hotelToday("Asia/Kolkata", new Date("2026-10-10T20:30:00Z"));
    expect(t.today).toBe("2026-10-11");
    expect(t.weekend).toBe(true);
  });
});
