import { describe, expect, it } from "vitest";

import {
  bucketComparisonCancelledMessage,
  buildBucketCompareMappingModel,
  compareObjectDetailsFromKeys,
  resolveBucketCompareRunSettlement,
  sourceCompareObjectDetailFromDiff,
  targetCompareObjectDetailFromDiff,
  updateBucketCompareRunItem,
  updateBucketCompareRunProgress,
} from "./bucketCompareShared";

const buildModel = (
  overrides: Partial<Parameters<typeof buildBucketCompareMappingModel>[0]> = {}
) =>
  buildBucketCompareMappingModel({
    targetSelected: true,
    targetKind: "context",
    sourceBuckets: ["alpha", "beta"],
    targetBuckets: ["alpha", "gamma"],
    sameTargetSelected: false,
    mappingMode: "by_name",
    rawMapping: new Map(),
    manualMapping: {},
    ...overrides,
  });

describe("bucket comparison mapping model", () => {
  it("builds the by-name plan and reports missing targets", () => {
    const model = buildModel();

    expect(model.comparePlan).toEqual({
      mappings: [
        { sourceBucket: "alpha", targetBucket: "alpha" },
        { sourceBucket: "beta", targetBucket: "beta" },
      ],
      error: null,
    });
    expect(model.missingByName).toEqual(["beta"]);
  });

  it("resolves raw mappings before manual values and by-name fallbacks", () => {
    const model = buildModel({
      sourceBuckets: ["alpha", "beta", "gamma"],
      targetBuckets: ["alpha", "gamma"],
      mappingMode: "manual",
      rawMapping: new Map([["alpha", "raw-alpha"]]),
      manualMapping: { alpha: "manual-alpha", beta: "manual-beta" },
    });

    expect(Object.fromEntries(model.resolvedManualMapping)).toEqual({
      alpha: "raw-alpha",
      beta: "manual-beta",
      gamma: "gamma",
    });
    expect(model.comparePlan.mappings).toEqual([
      { sourceBucket: "alpha", targetBucket: "raw-alpha" },
      { sourceBucket: "beta", targetBucket: "manual-beta" },
      { sourceBucket: "gamma", targetBucket: "gamma" },
    ]);
  });

  it("excludes selected source buckets from same-target choices", () => {
    const model = buildModel({
      targetKind: "endpoint",
      targetBuckets: ["alpha", "beta", "archive"],
      sameTargetSelected: true,
      mappingMode: "manual",
      manualMapping: { alpha: "beta", beta: "archive" },
    });

    expect(model.availableTargetBucketNames).toEqual(["archive"]);
    expect(model.comparePlan).toEqual({
      mappings: [],
      error: "When source and target endpoint are the same, mapped target buckets must be outside the selected source set.",
    });
  });

  it("keeps target-specific validation messages in the shared plan", () => {
    expect(buildModel({ targetSelected: false }).comparePlan.error).toBe(
      "Select a target context."
    );
    expect(
      buildModel({
        targetKind: "endpoint",
        sameTargetSelected: true,
      }).comparePlan.error
    ).toBe("Same-endpoint comparison requires manual mapping.");
  });
});

describe("bucket comparison run settlement", () => {
  it("turns fulfilled comparisons into successful run items", () => {
    const settlement = resolveBucketCompareRunSettlement(
      { status: "fulfilled", value: { has_differences: false } },
      false
    );

    expect(
      updateBucketCompareRunItem(
        { status: "running" as const, sourceBucket: "source", actionRunning: null },
        settlement
      )
    ).toEqual({
      status: "success",
      sourceBucket: "source",
      actionRunning: null,
      result: { has_differences: false },
    });
    expect(
      updateBucketCompareRunProgress(
        { completed: 1, total: 3, failed: 0, cancelled: 0 },
        settlement
      )
    ).toEqual({ completed: 2, total: 3, failed: 0, cancelled: 0 });
  });

  it("normalizes rejected and explicitly cancelled comparisons", () => {
    const failed = resolveBucketCompareRunSettlement(
      { status: "rejected", reason: new Error("Backend comparison failed") },
      false
    );
    const aborted = resolveBucketCompareRunSettlement(
      { status: "rejected", reason: new DOMException("Aborted", "AbortError") },
      false
    );
    const cancelledAfterSuccess = resolveBucketCompareRunSettlement(
      { status: "fulfilled", value: { has_differences: true } },
      true
    );

    expect(failed).toEqual({ status: "failed", error: "Backend comparison failed" });
    expect(aborted).toEqual({
      status: "cancelled",
      error: bucketComparisonCancelledMessage,
    });
    expect(cancelledAfterSuccess).toEqual({
      status: "cancelled",
      error: bucketComparisonCancelledMessage,
    });
    expect(
      updateBucketCompareRunProgress(
        { completed: 0, total: 2, failed: 0, cancelled: 0 },
        failed
      )
    ).toEqual({ completed: 1, total: 2, failed: 1, cancelled: 0 });
  });
});

describe("bucket comparison object detail projection", () => {
  it("builds fallback and side-specific object details", () => {
    const diff = {
      key: "folder/object.txt",
      source_size: 12,
      target_size: 14,
      source_etag: "source-etag",
      target_etag: "target-etag",
      source_last_modified: "2026-01-01T00:00:00Z",
      target_last_modified: "2026-01-02T00:00:00Z",
      source_storage_class: "STANDARD",
      target_storage_class: "GLACIER",
    };

    expect(compareObjectDetailsFromKeys(["a", "b"])).toEqual([
      { key: "a" },
      { key: "b" },
    ]);
    expect(sourceCompareObjectDetailFromDiff(diff)).toEqual({
      key: "folder/object.txt",
      size: 12,
      etag: "source-etag",
      last_modified: "2026-01-01T00:00:00Z",
      storage_class: "STANDARD",
    });
    expect(targetCompareObjectDetailFromDiff(diff)).toEqual({
      key: "folder/object.txt",
      size: 14,
      etag: "target-etag",
      last_modified: "2026-01-02T00:00:00Z",
      storage_class: "GLACIER",
    });
  });
});
