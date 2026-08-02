import { describe, expect, it } from "vitest";

import { buildBucketCompareMappingModel } from "./bucketCompareShared";

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
