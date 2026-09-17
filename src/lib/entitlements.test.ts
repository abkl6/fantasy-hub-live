import { describe, expect, it } from "vitest";

import { hasPremium, FOUNDING_EXPIRES_AT } from "./entitlements";

describe("hasPremium", () => {
  const now = new Date("2026-09-17T00:00:00Z");

  it("is false without an entitlement", () => {
    expect(hasPremium(null, now)).toBe(false);
  });

  it("is false for the free tier", () => {
    expect(hasPremium({ tier: "free", source: "admin", expiresAt: null }, now)).toBe(false);
  });

  it("is true for founding members through the founding season", () => {
    expect(
      hasPremium({ tier: "premium", source: "founding", expiresAt: FOUNDING_EXPIRES_AT }, now),
    ).toBe(true);
  });

  it("is false once the entitlement has expired", () => {
    expect(
      hasPremium({ tier: "premium", source: "stripe", expiresAt: "2026-08-01T00:00:00Z" }, now),
    ).toBe(false);
  });

  it("never expires when there is no expiry", () => {
    expect(hasPremium({ tier: "premium", source: "admin", expiresAt: null }, now)).toBe(true);
  });
});
