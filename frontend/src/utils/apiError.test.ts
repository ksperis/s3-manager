import { describe, expect, it } from "vitest";
import { ApiError } from "../api/client";

import {
  classifyApiError,
  extractApiError,
  isApiFeatureNotImplemented,
  isRecentWebAuthnRequired,
  sanitizeErrorMessage,
} from "./apiError";

describe("extractApiError", () => {
  it("prefers backend detail when available", () => {
    const error = new ApiError("Request failed with status 403", {
      response: { status: 403, data: { detail: "Forbidden by policy" }, headers: {} },
    });

    expect(extractApiError(error, "Fallback message")).toBe("Forbidden by policy");
  });

  it("normalizes low-level network errors when backend detail is missing", () => {
    const error = new ApiError("Failed to fetch");

    expect(extractApiError(error, "Fallback message")).toBe("Fallback message");
  });

  it("falls back to provided fallback when error is unstructured", () => {
    expect(extractApiError({ foo: "bar" }, "Fallback message")).toBe("Fallback message");
  });

  it("uses the sanitized backend detail for upstream timeouts", () => {
    const failure = classifyApiError(
      new ApiError("Request timeout", {
        code: "ETIMEDOUT",
        response: {
          status: 504,
          data: { detail: "HTTPConnectionPool(host='10.0.0.5', port=7480): Read timed out" },
          headers: {},
        },
      }),
      "Storage endpoint is unavailable."
    );

    expect(failure).toEqual({
      kind: "timeout",
      message: "[redacted-endpoint]: Read timed out",
      retryable: true,
      status: 504,
    });
  });

  it.each([
    [502, "invalid_response"],
    [503, "unavailable"],
    [504, "timeout"],
  ] as const)("keeps sanitized backend detail for status %s", (status, kind) => {
    const failure = classifyApiError(
      new ApiError("Request failed", {
        response: {
          status,
          data: {
            detail: "Storage request to https://rgw.internal:7480 failed with secret_access_key=do-not-show",
          },
          headers: {},
        },
      }),
      "Operation failed."
    );

    expect(failure.kind).toBe(kind);
    expect(failure.message).toBe("Storage request to [redacted-url] failed with secret_access_key=[redacted]");
    expect(failure.message).not.toContain("rgw.internal");
    expect(failure.message).not.toContain("do-not-show");
  });

  it("redacts connection-pool endpoint details", () => {
    const message = sanitizeErrorMessage("HTTPConnectionPool(host='10.0.0.5', port=7480): Read timed out");

    expect(message).toContain("[redacted-endpoint]");
    expect(message).not.toContain("10.0.0.5");
    expect(message).not.toContain("7480");
  });

  it("redacts sensitive values from backend details", () => {
    const error = new ApiError("Request failed with status 500", {
      response: {
        status: 500,
        data: {
          detail:
            "Request to https://rgw.internal.local:7480/admin failed with access_key=AKIAIOSFODNN7EXAMPLE and secret_access_key=very-secret",
        },
        headers: {},
      },
    });

    const message = extractApiError(error, "Fallback message");

    expect(message).toContain("[redacted-url]");
    expect(message).toContain("access_key=[redacted]");
    expect(message).toContain("secret_access_key=[redacted]");
    expect(message).not.toContain("rgw.internal.local");
    expect(message).not.toContain("AKIAIOSFODNN7EXAMPLE");
    expect(message).not.toContain("very-secret");
  });

  it("redacts bearer tokens and presigned URL parameters from generic messages", () => {
    const message = sanitizeErrorMessage(
      "Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.example and url=https://s3.example.test/bucket/key?X-Amz-Signature=abcdef"
    );

    expect(message).toContain("Bearer [redacted]");
    expect(message).toContain("[redacted-url]");
    expect(message).not.toContain("eyJhbGciOiJIUzI1NiJ9");
    expect(message).not.toContain("abcdef");
  });

  it("detects not implemented feature errors from extracted messages", () => {
    expect(isApiFeatureNotImplemented("An error occurred (XNotImplemented) when calling the GetBucketLogging operation")).toBe(true);
    expect(isApiFeatureNotImplemented("The request you provided implies functionality that is not implemented.")).toBe(true);
    expect(isApiFeatureNotImplemented("AccessDenied")).toBe(false);
    expect(isApiFeatureNotImplemented(null)).toBe(false);
  });

  it("detects only the exact recent WebAuthn guard response", () => {
    const required = new ApiError("Request failed", {
      response: {
        status: 403,
        data: { detail: "Recent WebAuthn verification required" },
        headers: {},
      },
    });
    const unrelated = new ApiError("Request failed", {
      response: { status: 403, data: { detail: "Forbidden by policy" }, headers: {} },
    });

    expect(isRecentWebAuthnRequired(required)).toBe(true);
    expect(isRecentWebAuthnRequired(unrelated)).toBe(false);
    expect(isRecentWebAuthnRequired(new Error("Recent WebAuthn verification required"))).toBe(false);
  });
});
