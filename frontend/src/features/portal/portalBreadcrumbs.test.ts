import { describe, expect, it } from "vitest";

import { portalBreadcrumbs } from "./portalBreadcrumbs";

describe("portalBreadcrumbs", () => {
  it("keeps Portal as the end-user root breadcrumb", () => {
    expect(portalBreadcrumbs({ label: "Storage Spaces", to: "/portal/storage-spaces" }, { label: "photos" })).toEqual([
      { label: "Portal", to: "/portal" },
      { label: "Storage Spaces", to: "/portal/storage-spaces" },
      { label: "photos" },
    ]);
  });
});
