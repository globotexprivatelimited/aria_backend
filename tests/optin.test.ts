import { optInOf } from "../src/lib/optin";

const req = (body: Record<string, unknown>) => ({ body, header: () => "" }) as unknown as import("express").Request;

describe("opt-in at check-in is explicit, recorded, and never assumed", () => {
  test("ticked on the registration card", () => {
    expect(optInOf(req({ optIn: true, optInBy: "Rahul" }))).toEqual({ source: "registration_card", by: "Rahul (unverified)" });
    expect(optInOf(req({ whatsappOptIn: "true" }))).toEqual({ source: "registration_card", by: "staff" });
  });
  test("not ticked, or absent, means no opt-in", () => {
    expect(optInOf(req({}))).toBeNull();
    expect(optInOf(req({ optIn: false }))).toBeNull();
    expect(optInOf(req({ optIn: "yes" }))).toBeNull();
  });
});
