import { renderProfile, emptyProfile, renderSpaRules, defaultSpaRules, renderServices, spaNeedsHuman, MANDATORY, checkSpaRules, type Service } from "../src/knowledge/forms";

describe("knowledge base forms 1, 4 and 5", () => {
  test("hotel essentials render only what is filled", () => {
    expect(renderProfile(emptyProfile())).toBe("");
    const text = renderProfile({ ...emptyProfile(), checkInTime: "14:00", checkOutTime: "11:00", wifiName: "Sunanda-Guest", wifiPassword: "welcome123", breakfastHours: "07:00-10:30", breakfastPlace: "The Terrace", frontDeskPhone: "+91 33 4000 1000" }, "Sunanda Hotel");
    expect(text).toMatch(/HOTEL ESSENTIALS - Sunanda Hotel/);
    expect(text).toMatch(/Check-in from 14:00; check-out by 11:00/);
    expect(text).toMatch(/Wi-Fi: network Sunanda-Guest, password welcome123/);
    expect(text).toMatch(/Breakfast: 07:00-10:30 at The Terrace/);
    expect(text).not.toMatch(/Parking/);
  });
  test("six mandatory fields, named once", () => {
    expect(MANDATORY.map((m) => m.key)).toEqual(["checkInTime", "checkOutTime", "frontDeskPhone", "wifiName", "breakfastHours", "address"]);
  });
  test("spa rules: notice, window, and medical mentions go to a person", () => {
    expect(renderSpaRules(defaultSpaRules())).toBe("");
    const text = renderSpaRules({ ...defaultSpaRules(), set: true, advanceNoticeMins: 120, firstAppointment: "09:00", lastAppointment: "19:00", cancellation: "free up to 2 hours before" });
    expect(text).toMatch(/Bookings need 2 hours' notice; appointments from 09:00 to 19:00/);
    expect(text).toMatch(/Cancellation: free up to 2 hours before/);
    expect(text).toMatch(/pregnancy.*do NOT book/);
    expect(renderSpaRules({ ...defaultSpaRules(), set: true, medicalToHuman: false })).not.toMatch(/pregnancy/);
    expect(checkSpaRules({ lastAppointment: "7pm" })).toMatch(/HH:MM/);
    expect(checkSpaRules({ advanceNoticeMins: 90 })).toBeNull();
  });
  test("the words that need a therapist, in English and Hindi", () => {
    expect(spaNeedsHuman("I am pregnant, is the deep tissue massage ok?")).toBe(true);
    expect(spaNeedsHuman("I had knee surgery last month")).toBe(true);
    expect(spaNeedsHuman("main garbhvati hoon, massage theek hai?")).toBe(true);
    expect(spaNeedsHuman("Book a Swedish massage at 5pm please")).toBe(false);
    expect(spaNeedsHuman("the hotel is in the heart of the city")).toBe(false);
  });
  test("services and prices as one list", () => {
    const s = (over: Partial<Service>): Service => ({ id: "1", name: "Airport pickup", price: "Rs 1,500", unit: "per car", hours: "24 hours", dept: "concierge", how: "book 6 hours ahead", active: true, sortOrder: 0, updatedAt: "", updatedBy: null, ...over });
    const text = renderServices([s({}), s({ id: "2", name: "Laundry", price: null, unit: null, hours: "same day if in by 10:00", dept: null, how: null }), s({ id: "3", name: "Old", active: false })]);
    expect(text).toMatch(/Airport pickup: Rs 1,500 per car; 24 hours; book 6 hours ahead \(concierge\)/);
    expect(text).toMatch(/Laundry: price on request; same day if in by 10:00/);
    expect(text).not.toMatch(/Old/);
    expect(renderServices([])).toBe("");
  });
});
