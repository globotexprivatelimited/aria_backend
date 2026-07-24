import { parseAdminCommand } from "../src/lib/adminCommands";

describe("admin command parser", () => {
  it("parses emergency-mode toggles", () => {
    expect(parseAdminCommand("EMERGENCY MODE ON").kind).toBe("emergency_on");
    expect(parseAdminCommand("emergency mode off").kind).toBe("emergency_off");
  });
  it("parses checkin", () => {
    expect(parseAdminCommand("CHECKIN 305 +919876543210 John Doe")).toEqual({
      kind: "checkin", room: "305", phone: "+919876543210", name: "John Doe",
    });
  });
  it("parses checkout", () => {
    expect(parseAdminCommand("CHECKOUT 305")).toEqual({ kind: "checkout", target: "305" });
  });
  it("returns unknown for gibberish", () => {
    expect(parseAdminCommand("hello there").kind).toBe("unknown");
  });
});
