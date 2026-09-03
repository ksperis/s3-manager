import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  bucketComparisonCancelledMessage,
  buildBucketCompareMappingModel,
  compareObjectDetailsFromKeys,
  matchesBucketCompareRunFilters,
  parseOptionalIsoDateTime,
  mergeRawBucketCompareMappings,
  reconcileBucketCompareManualMapping,
  resolveBucketCompareRunSettlement,
  sourceCompareObjectDetailFromDiff,
  summarizeBucketCompareRun,
  targetCompareObjectDetailFromDiff,
  updateBucketCompareRunItem,
  updateBucketCompareRunProgress,
  updateBucketCompareConfigFeatures,
  useBucketCompareConfigFeatures,
  useBucketCompareManualMappingState,
  useBucketCompareRunState,
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

describe("bucket comparison configuration state", () => {
  it("reconciles selected sources while preserving explicit manual targets", () => {
    expect(
      reconcileBucketCompareManualMapping({
        previous: { alpha: " custom-alpha ", stale: "archive" },
        sourceBuckets: ["alpha", "beta", "missing"],
        targetBuckets: ["alpha", "beta"],
        sameTargetSelected: false,
      })
    ).toEqual({ alpha: "custom-alpha", beta: "beta" });
    expect(
      reconcileBucketCompareManualMapping({
        previous: { alpha: "beta", beta: "external" },
        sourceBuckets: ["alpha", "beta"],
        targetBuckets: ["alpha", "beta", "external"],
        sameTargetSelected: true,
      })
    ).toEqual({ beta: "external" });
  });

  it("merges raw mappings only for selected sources and preserves identity when unchanged", () => {
    const previous = { alpha: "raw-alpha", beta: "manual-beta" };
    const rawMapping = new Map([
      ["alpha", "raw-alpha"],
      ["beta", "raw-beta"],
      ["stale", "raw-stale"],
    ]);

    expect(mergeRawBucketCompareMappings(previous, ["alpha"], rawMapping)).toBe(
      previous
    );
    expect(
      mergeRawBucketCompareMappings(previous, ["alpha", "beta"], rawMapping)
    ).toEqual({ alpha: "raw-alpha", beta: "raw-beta" });
  });

  it("updates selected configuration features in canonical order", () => {
    const ordered = ["versioning", "policy", "tags"] as const;

    expect(
      updateBucketCompareConfigFeatures(["tags"], ordered, "versioning", true)
    ).toEqual(["versioning", "tags"]);
    expect(
      updateBucketCompareConfigFeatures(
        ["versioning", "policy"],
        ordered,
        "versioning",
        false
      )
    ).toEqual(["policy"]);
  });

  it("owns manual and raw mapping transitions for comparison consumers", async () => {
    const sourceBuckets = ["alpha", "beta"];
    const targetBuckets = ["alpha", "beta", "archive"];
    const { result, rerender } = renderHook(
      ({ sameTargetSelected }) =>
        useBucketCompareManualMappingState({
          mappingMode: "manual",
          sourceBuckets,
          targetBuckets,
          sameTargetSelected,
        }),
      { initialProps: { sameTargetSelected: false } }
    );

    await waitFor(() => {
      expect(result.current.manualMapping).toEqual({ alpha: "alpha", beta: "beta" });
    });

    act(() => result.current.setRawMappingText("alpha => archive"));
    await waitFor(() => {
      expect(result.current.manualMapping).toEqual({ alpha: "archive", beta: "beta" });
    });

    rerender({ sameTargetSelected: true });
    await waitFor(() => {
      expect(result.current.manualMapping).toEqual({ alpha: "archive" });
    });
  });

  it("owns canonically ordered configuration feature selection", () => {
    const orderedFeatures = ["versioning", "policy", "tags"] as const;
    const { result } = renderHook(() =>
      useBucketCompareConfigFeatures(orderedFeatures)
    );

    act(() => result.current.toggleConfigFeature("policy", false));
    expect(result.current.selectedConfigFeatures).toEqual(["versioning", "tags"]);

    act(() => result.current.setSelectedConfigFeatures(["tags"]));
    act(() => result.current.toggleConfigFeature("policy", true));
    expect(result.current.selectedConfigFeatures).toEqual(["policy", "tags"]);
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

  it("owns run progress, items, and cancellation interpretation", () => {
    const { result } = renderHook(() =>
      useBucketCompareRunState<
        { has_differences: boolean },
        {
          sourceBucket: string;
          targetBucket: string;
          status: "pending" | "running" | "success" | "failed" | "cancelled";
          result?: { has_differences: boolean };
          error?: string;
        }
      >()
    );

    act(() => {
      result.current.setProgress({ completed: 0, total: 1, failed: 0, cancelled: 0 });
      result.current.setItems([
        { sourceBucket: "alpha", targetBucket: "bravo", status: "running" },
      ]);
    });
    act(() => {
      result.current.settleRunItem(
        { status: "fulfilled", value: { has_differences: true } },
        0
      );
    });

    expect(result.current.progress).toEqual({
      completed: 1,
      total: 1,
      failed: 0,
      cancelled: 0,
    });
    expect(result.current.items[0]).toMatchObject({
      status: "success",
      result: { has_differences: true },
    });
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

describe("bucket comparison run presentation", () => {
  const items = [
    {
      sourceBucket: "Source Alpha",
      targetBucket: "archive",
      status: "success" as const,
      result: { has_differences: true },
    },
    {
      sourceBucket: "beta",
      targetBucket: "Target Beta",
      status: "success" as const,
      result: { has_differences: false },
    },
    {
      sourceBucket: "gamma",
      targetBucket: "archive",
      status: "success" as const,
    },
    {
      sourceBucket: "delta",
      targetBucket: "archive",
      status: "failed" as const,
      error: "Permission denied",
    },
    {
      sourceBucket: "epsilon",
      targetBucket: "archive",
      status: "cancelled" as const,
    },
  ];

  it("summarizes terminal statuses and results in one shared model", () => {
    expect(summarizeBucketCompareRun(items)).toEqual({
      success: 3,
      failed: 1,
      cancelled: 1,
      withDiff: 1,
    });
  });

  it("matches status, difference, and case-insensitive text filters", () => {
    expect(
      items.filter((item) =>
        matchesBucketCompareRunFilters(item, {
          search: "  permission ",
          status: "failed",
          differences: "all",
        })
      )
    ).toEqual([items[3]]);
    expect(
      items.filter((item) =>
        matchesBucketCompareRunFilters(item, {
          search: "TARGET BETA",
          status: "all",
          differences: "no_diff",
        })
      )
    ).toEqual([items[1]]);
    expect(
      items.filter((item) =>
        matchesBucketCompareRunFilters(item, {
          search: "source alpha",
          status: "all",
          differences: "with_diff",
        })
      )
    ).toEqual([items[0]]);
  });

  it("keeps successful results without an explicit difference flag in no-diff results", () => {
    expect(
      items.filter((item) =>
        matchesBucketCompareRunFilters(item, {
          search: "",
          status: "all",
          differences: "no_diff",
        })
      )
    ).toEqual([items[1], items[2]]);
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

describe("parseOptionalIsoDateTime", () => {
  it.each([
    ["", null],
    ["   ", null],
    ["not-a-date", null],
    ["2026-09-03T10:15:00Z", "2026-09-03T10:15:00.000Z"],
  ] as const)("parses %s", (value, expected) => {
    expect(parseOptionalIsoDateTime(value)).toBe(expected);
  });
});
