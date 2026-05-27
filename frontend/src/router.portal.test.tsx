import { describe, expect, it } from "vitest";
import { PORTAL_LEGACY_REDIRECTS } from "./router";

describe("portal legacy redirects", () => {
  it("keeps old portal routes mapped to the storage workspace UX", () => {
    expect(PORTAL_LEGACY_REDIRECTS).toEqual({
      buckets: "/portal/storage-spaces",
      manage: "/portal/shares",
      billing: "/portal/usage",
      browser: "/portal/storage-spaces",
    });
  });
});
