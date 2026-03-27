import { describe, expect, it } from "vitest";
import {
  normalizeBrowserListingIssue,
  resolveBucketAccessEntry,
  sanitizeBucketAccessEntries,
  splitBucketPanelBuckets,
} from "../browserBucketsPanelHelpers";

describe("browserBucketsPanelHelpers", () => {
  it("pins the active bucket even when it is missing from the loaded page", () => {
    const result = splitBucketPanelBuckets("bucket-9", [{ name: "bucket-1" }, { name: "bucket-2" }]);

    expect(result.currentBucket).toEqual({ name: "bucket-9", creation_date: null });
    expect(result.otherBuckets.map((bucket) => bucket.name)).toEqual(["bucket-1", "bucket-2"]);
  });

  it("sanitizes transient checking entries before restoring them", () => {
    const sanitized = sanitizeBucketAccessEntries({
      alpha: { status: "checking", detail: null },
      beta: { status: "unavailable", detail: "Forbidden by policy" },
    });

    expect(sanitized).toEqual({
      alpha: { status: "unknown", detail: null },
      beta: { status: "unavailable", detail: "Forbidden by policy" },
    });
  });

  it("falls back to an unknown access state when a bucket has not been probed yet", () => {
    expect(resolveBucketAccessEntry("bucket-1", {})).toEqual({
      status: "unknown",
      detail: null,
    });
  });

  it("normalizes access denied listing errors", () => {
    const issue = normalizeBrowserListingIssue(
      {
        isAxiosError: true,
        response: {
          status: 403,
          data: { detail: "Forbidden by policy" },
        },
        message: "Request failed with status code 403",
      },
      "Fallback message",
    );

    expect(issue).toEqual({
      kind: "access_denied",
      title: "Listing is not available for this bucket.",
      description:
        "The current credentials cannot list objects or folders in this bucket.",
      technicalDetail: "Forbidden by policy",
    });
  });

  it("normalizes non-access listing failures as request errors", () => {
    const issue = normalizeBrowserListingIssue(
      new Error("Network Error"),
      "Fallback message",
    );

    expect(issue).toEqual({
      kind: "request_failed",
      title: "Unable to load objects for this bucket.",
      description: "Retry in a moment.",
      technicalDetail: "Network Error",
    });
  });
});
