import { describe, expect, it } from "vitest";
import {
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
});
