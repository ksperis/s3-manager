import { describe, expect, it } from "vitest";

import { extractApiError, isApiFeatureNotImplemented } from "./apiError";

describe("extractApiError", () => {
  it("prefers backend detail when available", () => {
    const error = {
      isAxiosError: true,
      response: { data: { detail: "Forbidden by policy" } },
      message: "Request failed with status code 403",
    };

    expect(extractApiError(error, "Fallback message")).toBe("Forbidden by policy");
  });

  it("falls back to error.message when backend detail is missing", () => {
    const error = {
      isAxiosError: true,
      response: { data: {} },
      message: "Network Error",
    };

    expect(extractApiError(error, "Fallback message")).toBe("Network Error");
  });

  it("falls back to provided fallback when error is unstructured", () => {
    expect(extractApiError({ foo: "bar" }, "Fallback message")).toBe("Fallback message");
  });

  it("detects not implemented feature errors from extracted messages", () => {
    expect(isApiFeatureNotImplemented("An error occurred (XNotImplemented) when calling the GetBucketLogging operation")).toBe(true);
    expect(isApiFeatureNotImplemented("The request you provided implies functionality that is not implemented.")).toBe(true);
    expect(isApiFeatureNotImplemented("AccessDenied")).toBe(false);
    expect(isApiFeatureNotImplemented(null)).toBe(false);
  });
});
