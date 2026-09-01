import { describe, expect, it } from "vitest";
import {
  defaultAccountAccessGrant,
  hasAccountAccessRole,
  parseManagerAccountRole,
  parsePortalAccountRole,
} from "./accountAccess";

describe("account access roles", () => {
  it("parses nullable Manager and Portal roles without a permissive fallback", () => {
    expect(parseManagerAccountRole("")).toBeNull();
    expect(parseManagerAccountRole("account_administrator")).toBe(
      "account_administrator",
    );
    expect(parsePortalAccountRole("")).toBeNull();
    expect(parsePortalAccountRole("portal_manager")).toBe("portal_manager");
    expect(() => parsePortalAccountRole("account_administrator")).toThrow(
      "Invalid Portal account role",
    );
  });

  it("requires at least one role", () => {
    expect(hasAccountAccessRole({ manager_role: null, portal_role: null })).toBe(false);
    expect(
      hasAccountAccessRole({
        manager_role: "account_administrator",
        portal_role: null,
      }),
    ).toBe(true);
  });

  it("uses explicit feature-dependent defaults for new associations", () => {
    expect(defaultAccountAccessGrant(true)).toEqual({
      manager_role: null,
      portal_role: "portal_user",
    });
    expect(defaultAccountAccessGrant(false)).toEqual({
      manager_role: "account_administrator",
      portal_role: null,
    });
  });
});
