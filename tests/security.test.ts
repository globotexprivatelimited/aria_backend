import { createHmac } from "crypto";
import { verifyMetaSignature, isPlaceholderSecret, validatePassword } from "../src/lib/security";

describe("Meta webhook signature (D-001)", () => {
  const secret = "test-app-secret-0123456789";
  const body = Buffer.from(JSON.stringify({ object: "whatsapp_business_account", entry: [] }));
  const good = "sha256=" + createHmac("sha256", secret).update(body).digest("hex");

  it("accepts a correctly signed body", () => {
    expect(verifyMetaSignature(body, good, secret)).toBe(true);
  });
  it("rejects a missing header", () => {
    expect(verifyMetaSignature(body, undefined, secret)).toBe(false);
  });
  it("rejects a wrong signature", () => {
    expect(verifyMetaSignature(body, "sha256=" + "0".repeat(64), secret)).toBe(false);
  });
  it("rejects when the secret is not configured (fail closed)", () => {
    expect(verifyMetaSignature(body, good, "")).toBe(false);
  });
  it("rejects a tampered body", () => {
    expect(verifyMetaSignature(Buffer.from("{}"), good, secret)).toBe(false);
  });
});

describe("placeholder secrets are refused in production (D-012, D-023)", () => {
  it("flags the known dev values", () => {
    expect(isPlaceholderSecret("dev-secret")).toBe(true);
    expect(isPlaceholderSecret("dev-admin-key")).toBe(true);
    expect(isPlaceholderSecret("aria_verify", 16)).toBe(true);
    expect(isPlaceholderSecret("aria_dev_jwt_secret_change_in_prod_8f3k2j9x")).toBe(true);
    expect(isPlaceholderSecret(undefined)).toBe(true);
    expect(isPlaceholderSecret("short")).toBe(true);
  });
  it("accepts a long random value", () => {
    expect(isPlaceholderSecret("9f2c7a1e4b8d3f6a0c5e2b7d9a1f4c8e6b3d0a7f")).toBe(false);
  });
});

describe("password policy (D-032)", () => {
  it("rejects a password equal to the email", () => {
    expect(validatePassword("mahi@gmail.com", "mahi@gmail.com")).not.toBeNull();
  });
  it("rejects short, letters-only or common passwords", () => {
    expect(validatePassword("short1")).not.toBeNull();
    expect(validatePassword("onlyletterspassword")).not.toBeNull();
    expect(validatePassword("password1")).not.toBeNull();
  });
  it("accepts a reasonable password", () => {
    expect(validatePassword("Sunanda-Front-Desk-2026", "sup@gmail.com")).toBeNull();
  });
});
