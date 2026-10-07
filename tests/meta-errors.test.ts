import { classifyMetaError, metaErrorCode, explainMetaError } from "../src/lib/metaErrors";

describe("Meta's error codes are sorted into what to do about them", () => {
  test("codes are read from the shapes Meta uses", () => {
    expect(metaErrorCode("131047 Re-engagement message")).toBe(131047);
    expect(metaErrorCode("400 Bad Request: (#131026) Message Undeliverable")).toBe(131026);
    expect(metaErrorCode("190 Error validating access token: Session has expired")).toBe(190);
    expect(metaErrorCode("network: fetch failed")).toBeNull();
  });
  test("window, undeliverable, rate, token, template", () => {
    expect(classifyMetaError("131047 Re-engagement message")).toBe("window");
    expect(classifyMetaError("131026 Message Undeliverable")).toBe("undeliverable");
    expect(classifyMetaError("130429 Rate limit hit")).toBe("rate");
    expect(classifyMetaError("190 Error validating access token")).toBe("token");
    expect(classifyMetaError("132001 Template name does not exist in the translation")).toBe("template");
    expect(classifyMetaError("WhatsApp is not configured on this server")).toBe("config");
    expect(classifyMetaError("network: fetch failed")).toBe("other");
  });
  test("the console gets plain words", () => {
    expect(explainMetaError("131047 Re-engagement message")).toMatch(/24 hours/);
    expect(explainMetaError("131026 Message Undeliverable")).toMatch(/cannot receive/);
  });
});
