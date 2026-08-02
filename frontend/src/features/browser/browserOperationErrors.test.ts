import { describe, expect, it } from "vitest";

import {
  extractBrowserErrorDetails,
  formatBrowserOperationError,
} from "./browserOperationErrors";

describe("browser operation errors", () => {
  it("extracts JSON, object, XML, and plain-text details", () => {
    expect(
      extractBrowserErrorDetails(
        JSON.stringify({ error_code: "AccessDenied", detail: "Forbidden" }),
      ),
    ).toEqual({ code: "AccessDenied", message: "Forbidden" });
    expect(extractBrowserErrorDetails({ errorCode: "SlowDown", error: "Retry" })).toEqual({
      code: "SlowDown",
      message: "Retry",
    });
    expect(
      extractBrowserErrorDetails(
        "<Error><Code>NoSuchKey</Code><Message>Missing</Message></Error>",
      ),
    ).toEqual({ code: "NoSuchKey", message: "Missing" });
    expect(extractBrowserErrorDetails("  unavailable  ")).toEqual({
      message: "unavailable",
    });
  });

  it("limits unstructured response bodies", () => {
    expect(extractBrowserErrorDetails("x".repeat(400))?.message).toHaveLength(300);
  });

  it("formats Axios response details with HTTP context", () => {
    const error = {
      isAxiosError: true,
      message: "Request failed",
      response: {
        status: 403,
        statusText: "Forbidden",
        data: { code: "AccessDenied", message: "Denied" },
      },
    };

    expect(formatBrowserOperationError(error, "Download failed.")).toBe(
      "HTTP 403 Forbidden - AccessDenied: Denied",
    );
  });

  it("adds context without duplicating the fallback", () => {
    expect(
      formatBrowserOperationError(new Error("Network error"), "Download failed.", "archive.zip."),
    ).toBe("archive.zip: Network error");
    expect(formatBrowserOperationError(null, "Download failed.", "Download failed.")).toBe(
      "Download failed.",
    );
  });
});
