import { describe, expect, it } from "vitest";

import { resolveSimpleUploadOperation, shouldUseStsPresigner } from "../sseBrowserLogic";

describe("sseBrowserLogic", () => {
  it("forces simple upload to PUT when SSE-C is active", () => {
    const operation = resolveSimpleUploadOperation({ stsAvailable: false, sseActive: true });
    expect(operation).toBe("put_object");
  });

  it("bypasses STS presigner when SSE-C is active", () => {
    expect(shouldUseStsPresigner({ stsAvailable: true, sseActive: true })).toBe(false);
    expect(shouldUseStsPresigner({ stsAvailable: true, sseActive: false })).toBe(true);
  });
});
