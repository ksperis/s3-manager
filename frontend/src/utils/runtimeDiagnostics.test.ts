import { afterEach, describe, expect, it, vi } from "vitest";

import { reportRuntimeError, sanitizeConsoleArgs } from "./runtimeDiagnostics";

describe("runtime diagnostics", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("redacts sensitive strings in console arguments", () => {
    const args = sanitizeConsoleArgs([
      "failed against https://rgw.internal.local with token=secret-token and access_key=AKIAIOSFODNN7EXAMPLE",
    ]);

    expect(args).toEqual(["failed against [redacted-url] with token=[redacted] and access_key=[redacted]"]);
  });

  it("redacts sensitive object fields and nested strings", () => {
    const args = sanitizeConsoleArgs([
      {
        message: "request failed for https://internal.example.test/path",
        access_key_id: "AKIAIOSFODNN7EXAMPLE",
        nested: { signature: "abcdef" },
      },
    ]);

    expect(args).toEqual([
      {
        message: "request failed for [redacted-url]",
        access_key_id: "[redacted]",
        nested: { signature: "[redacted]" },
      },
    ]);
  });

  it("logs sanitized errors through the explicit helper", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    reportRuntimeError("Portal load failed", new Error("GET https://internal.example.test failed with secret_key=top-secret"));

    expect(spy).toHaveBeenCalledWith("Portal load failed", "Error: GET [redacted-url] failed with secret_key=[redacted]");
  });
});
