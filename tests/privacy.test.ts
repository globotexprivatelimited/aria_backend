import { maskPhone, redact } from "../src/privacy/redact";
import { isWithdrawalKeyword } from "../src/privacy/consent";

describe("privacy helpers", () => {
  it("masks phone numbers for logs", () => {
    expect(maskPhone("+919876543210")).toBe("+9198****3210");
    expect(maskPhone("123")).toBe("***");
  });

  it("redacts PII from text", () => {
    expect(redact("call me on +91 98765 43210")).toContain("[phone]");
    expect(redact("email guest@example.com")).toContain("[email]");
    expect(redact("card 4111 1111 1111 1111")).toContain("[card]");
  });

  it("recognises withdrawal keywords", () => {
    expect(isWithdrawalKeyword("STOP")).toBe(true);
    expect(isWithdrawalKeyword("delete my data")).toBe(true);
    expect(isWithdrawalKeyword("can I get towels")).toBe(false);
  });
});
