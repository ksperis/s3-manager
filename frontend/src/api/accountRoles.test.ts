import { describe, expect, it } from "vitest";
import { getAccountAccessRoleOptions } from "./accountRoles";

describe("getAccountAccessRoleOptions", () => {
  it("returns every canonical role when Portal is enabled", () => {
    expect(getAccountAccessRoleOptions(true)).toEqual([
      { value: "portal_user", label: "Portal user" },
      { value: "portal_manager", label: "Portal manager" },
      { value: "account_administrator", label: "Account administrator" },
    ]);
  });

  it("returns only account administrator for a new link when Portal is disabled", () => {
    expect(getAccountAccessRoleOptions(false)).toEqual([
      {
        value: "account_administrator",
        label: "Account administrator",
        disabled: false,
      },
    ]);
  });

  it("keeps an existing Portal role visible but disabled", () => {
    expect(getAccountAccessRoleOptions(false, "portal_manager")).toEqual([
      { value: "portal_manager", label: "Portal manager", disabled: true },
      {
        value: "account_administrator",
        label: "Account administrator",
        disabled: false,
      },
    ]);
  });
});
