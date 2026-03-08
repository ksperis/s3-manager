import { afterEach, describe, expect, it, vi } from "vitest";

import {
  SSE_CUSTOMER_ALGORITHM,
  buildSseCustomerBackendHeaders,
  generateSseCustomerKeyBase64,
  validateSseCustomerKeyBase64,
} from "./browser";

describe("browser SSE-C helpers", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("validates a base64 key that decodes to 32 bytes", () => {
    const raw = new Uint8Array(32);
    raw.forEach((_, idx) => {
      raw[idx] = idx;
    });
    const base64 = btoa(String.fromCharCode(...raw));

    const result = validateSseCustomerKeyBase64(base64);

    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.normalizedKey).toBe(base64);
    }
  });

  it("rejects invalid base64 and wrong key lengths", () => {
    const invalid = validateSseCustomerKeyBase64("not-base64");
    expect(invalid.valid).toBe(false);

    const short = validateSseCustomerKeyBase64(btoa("short-key"));
    expect(short.valid).toBe(false);
  });

  it("builds SSE-C backend headers from a valid key", () => {
    const raw = new Uint8Array(32);
    const base64 = btoa(String.fromCharCode(...raw));

    const headers = buildSseCustomerBackendHeaders(base64);

    expect(headers).toEqual({
      "X-S3-SSE-C-Key": base64,
      "X-S3-SSE-C-Algorithm": SSE_CUSTOMER_ALGORITHM,
    });
  });

  it("returns empty headers when no key is provided", () => {
    expect(buildSseCustomerBackendHeaders(undefined)).toEqual({});
    expect(buildSseCustomerBackendHeaders(null)).toEqual({});
  });

  it("generates a valid random SSE-C key in base64", () => {
    vi.spyOn(globalThis.crypto, "getRandomValues").mockImplementation((array) => {
      for (let index = 0; index < array.length; index += 1) {
        array[index] = index;
      }
      return array;
    });

    const keyBase64 = generateSseCustomerKeyBase64();
    const validation = validateSseCustomerKeyBase64(keyBase64);

    expect(validation.valid).toBe(true);
  });

  it("throws when secure randomness is unavailable", () => {
    vi.stubGlobal("crypto", undefined);
    expect(() => generateSseCustomerKeyBase64()).toThrow("Secure random generator is unavailable in this browser.");
  });
});
