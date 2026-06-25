import { describe, expect, it } from "vitest";

import { ADMIN_PAGE_CONTRACTS, adminPageBreadcrumbs } from "./adminBreadcrumbs";

describe("adminBreadcrumbs", () => {
  it("documents governance areas for major Admin pages", () => {
    expect(ADMIN_PAGE_CONTRACTS.users.governanceArea).toBe("identity");
    expect(ADMIN_PAGE_CONTRACTS.groups.governanceArea).toBe("identity");
    expect(ADMIN_PAGE_CONTRACTS.accounts.governanceArea).toBe("accounts");
    expect(ADMIN_PAGE_CONTRACTS["shared-connections"].governanceArea).toBe("connections");
    expect(ADMIN_PAGE_CONTRACTS["storage-endpoints"].governanceArea).toBe("endpoints");
  });

  it("builds page breadcrumbs from one Admin root", () => {
    expect(adminPageBreadcrumbs("users")).toEqual([
      { label: "Admin" },
      { label: "Interface" },
      { label: "UI Users" },
    ]);
    expect(adminPageBreadcrumbs("storage-endpoints")).toEqual([
      { label: "Admin" },
      { label: "Endpoints" },
    ]);
  });
});
