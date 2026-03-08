import { afterEach, describe, expect, it, vi } from "vitest";

import {
  activateSseCustomerKeyForScope,
  copySseCustomerKeyWithFallback,
  generateAndActivateSseCustomerKeyForScope,
  resolveSseCustomerKeyInputType,
} from "../sseCustomerKeyActions";
import { validateSseCustomerKeyBase64 } from "../../../api/browser";

describe("sseCustomerKeyActions", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("generates and immediately activates SSE-C key for the selected scope", () => {
    vi.spyOn(globalThis.crypto, "getRandomValues").mockImplementation((array) => {
      for (let index = 0; index < array.length; index += 1) {
        array[index] = (index + 13) % 256;
      }
      return array;
    });

    const scopeKey = "acc-1::bucket-a";
    const result = generateAndActivateSseCustomerKeyForScope({}, scopeKey);

    expect(result.next[scopeKey]).toBe(result.normalizedKey);
    expect(validateSseCustomerKeyBase64(result.normalizedKey).valid).toBe(true);
  });

  it("normalizes and stores a manually provided key for a scope", () => {
    const bytes = new Uint8Array(32);
    bytes.forEach((_, idx) => {
      bytes[idx] = idx;
    });
    const keyBase64 = btoa(String.fromCharCode(...bytes));

    const result = activateSseCustomerKeyForScope({}, "ctx::bucket", keyBase64);

    expect(result.next["ctx::bucket"]).toBe(keyBase64);
  });

  it("attempts automatic clipboard copy first", async () => {
    const writeText = vi.fn(async (_value: string) => undefined);
    const fallback = vi.fn();

    const outcome = await copySseCustomerKeyWithFallback("abc", writeText, fallback);

    expect(writeText).toHaveBeenCalledWith("abc");
    expect(fallback).not.toHaveBeenCalled();
    expect(outcome).toBe("copied");
  });

  it("uses fallback when clipboard copy fails", async () => {
    const writeText = vi.fn(async () => {
      throw new Error("denied");
    });
    const fallback = vi.fn();

    const outcome = await copySseCustomerKeyWithFallback("abc", writeText, fallback);

    expect(writeText).toHaveBeenCalledWith("abc");
    expect(fallback).toHaveBeenCalledTimes(1);
    expect(outcome).toBe("manual_copy_required");
  });

  it("switches key input type between masked and visible", () => {
    expect(resolveSseCustomerKeyInputType(false)).toBe("password");
    expect(resolveSseCustomerKeyInputType(true)).toBe("text");
  });
});
