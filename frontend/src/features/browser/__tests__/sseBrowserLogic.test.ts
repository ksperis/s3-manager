import { describe, expect, it } from "vitest";

import { resolveSimpleUploadOperation, shouldUseStsPresigner } from "../sseBrowserLogic";

describe("sseBrowserLogic", () => {
  it.each([
    { stsAvailable: false, sseActive: false },
    { stsAvailable: true, sseActive: false },
    { stsAvailable: false, sseActive: true },
    { stsAvailable: true, sseActive: true },
  ])("uses PUT for simple uploads with STS=$stsAvailable and SSE-C=$sseActive", () => {
    expect(resolveSimpleUploadOperation()).toBe("put_object");
  });

  it("bypasses STS presigner when SSE-C is active", () => {
    expect(shouldUseStsPresigner({ stsAvailable: true, sseActive: true })).toBe(false);
    expect(shouldUseStsPresigner({ stsAvailable: true, sseActive: false })).toBe(true);
  });
});
