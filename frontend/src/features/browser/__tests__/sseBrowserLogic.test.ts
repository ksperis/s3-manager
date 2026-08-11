import { describe, expect, it } from "vitest";

import { shouldUseStsPresigner } from "../sseBrowserLogic";

describe("sseBrowserLogic", () => {
  it("bypasses STS presigner when SSE-C is active", () => {
    expect(shouldUseStsPresigner({ stsAvailable: true, sseActive: true })).toBe(false);
    expect(shouldUseStsPresigner({ stsAvailable: true, sseActive: false })).toBe(true);
  });
});
