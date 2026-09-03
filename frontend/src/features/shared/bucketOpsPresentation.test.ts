import { describe, expect, it } from "vitest";
import type { CephAdminBucket } from "../../api/cephAdminBuckets";
import {
  areStringMapEqual,
  buildBucketUiTagKey,
  computeQuotaUsagePercent,
  csvEscape,
  formatBucketColumnDetail,
  formatBucketNamesPreview,
  formatOwnerSuspended,
  formatQuotaPercent,
  formatQuotaUsageValue,
  formatVersioningStatus,
  getBucketDisplayName,
  getStorageOpsBucketName,
  getStorageOpsContextId,
  isBucketQuotaConfigured,
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
    expect(isBucketQuotaConfigured(bucket({ quota_max_size_bytes: 1 }))).toBe(true);
    expect(isBucketQuotaConfigured(bucket({ quota_max_size_bytes: 0, quota_max_objects: null }))).toBe(false);
  });

  it("formats canonical feature detail values", () => {
    const details = bucket({
      column_details: {
        cors_allowed_methods: ["PUT", " GET ", "PUT"],
        lifecycle_transition_days: [30, "7", 30],
        policy_has_conditions: true,
        policy_statement_count: 3,
        logging_target_bucket: " logs ",
        logging_target_prefix: {},
      },
    });

    expect(formatBucketColumnDetail(details, "cors_allowed_methods")).toBe("PUT, GET");
    expect(formatBucketColumnDetail(details, "lifecycle_transition_days")).toBe("7, 30");
    expect(formatBucketColumnDetail(details, "policy_has_conditions")).toBe("Yes");
    expect(formatBucketColumnDetail(details, "policy_statement_count")).toBe("3");
    expect(formatBucketColumnDetail(details, "logging_target_bucket")).toBe("logs");
    expect(formatBucketColumnDetail(details, "logging_target_prefix")).toBe("-");
    expect(formatBucketColumnDetail(details, "website_index_document")).toBe("-");
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
