import { describe, expect, it } from "vitest";
import type { CephAdminBucket } from "../../api/cephAdmin";
import {
  areStringMapEqual,
  buildBucketUiTagKey,
  computeQuotaUsagePercent,
  csvEscape,
  formatBucketNamesPreview,
  formatOwnerSuspended,
  formatQuotaPercent,
  formatQuotaUsageValue,
  formatVersioningStatus,
  getBucketDisplayName,
  getStorageOpsBucketName,
  getStorageOpsContextId,
  normalizeVersioningStatus,
  ownerFilterFromSearch,
  sanitizeExportFilenamePart,
} from "./bucketOpsPresentation";

const bucket = (value: Record<string, unknown>) => value as CephAdminBucket;

describe("bucketOpsPresentation", () => {
  it("normalizes export filenames and CSV fields", () => {
    expect(sanitizeExportFilenamePart(" Primary / RGW ")).toBe("Primary_RGW");
    expect(sanitizeExportFilenamePart("---")).toBe("---");
    expect(sanitizeExportFilenamePart("***")).toBe("buckets");
    expect(csvEscape('a"b')).toBe('"a""b"');
  });

  it("normalizes and formats versioning states", () => {
    expect(normalizeVersioningStatus(" Enabled ")).toBe(true);
    expect(normalizeVersioningStatus("Suspended")).toBe(false);
    expect(normalizeVersioningStatus("custom")).toBeNull();
    expect(formatVersioningStatus(null)).toBe("Disabled");
    expect(formatVersioningStatus("Suspended")).toBe("Suspended");
  });

  it("computes quota usage without inventing missing limits", () => {
    expect(computeQuotaUsagePercent(25, 100)).toBe(25);
    expect(computeQuotaUsagePercent(-4, 100)).toBe(0);
    expect(computeQuotaUsagePercent(25, 0)).toBeNull();
    expect(formatQuotaPercent(9.876)).toBe("9.88%");
    expect(formatQuotaUsageValue(25, 100)).toBe("25.0%");
  });

  it("formats compact previews and nullable booleans", () => {
    expect(formatBucketNamesPreview(["a", "b", "c"], 2)).toBe("a, b (+1 more)");
    expect(formatOwnerSuspended(true)).toBe("Yes");
    expect(formatOwnerSuspended(false)).toBe("No");
    expect(formatOwnerSuspended(null)).toBe("-");
  });

  it("resolves canonical bucket and storage-ops identities", () => {
    const explicit = bucket({
      name: "ctx-1::encoded",
      bucket_name: " logs ",
      context_id: " account-1 ",
    });
    expect(getBucketDisplayName(explicit, true)).toBe("logs");
    expect(getStorageOpsContextId(explicit)).toBe("account-1");
    expect(getStorageOpsBucketName(explicit)).toBe("logs");
    expect(getBucketDisplayName(bucket({ name: "raw" }), false)).toBe("raw");
  });

  it("builds stable tag keys and compares string maps by value", () => {
    expect(buildBucketUiTagKey(" logs ", " tenant ")).toBe("tenant\u001flogs");
    expect(areStringMapEqual({ a: "1", b: "2" }, { b: "2", a: "1" })).toBe(true);
    expect(areStringMapEqual({ a: "1" }, { a: "2" })).toBe(false);
  });

  it("reads the canonical owner query parameter", () => {
    expect(ownerFilterFromSearch("?owner= Alice%20Smith ")).toBe("Alice Smith");
    expect(ownerFilterFromSearch("?owner=%20%20")).toBeNull();
    expect(ownerFilterFromSearch("?search=alice")).toBeNull();
  });
});
