import { describe, expect, it } from "vitest";
import type {
  BulkConfigClipboard,
  BulkConfigClipboardBucket,
} from "./bucketBulkOperationsModel";
import {
  buildBulkPastePlan,
  isBulkClipboardSameEndpoint,
  reconcileBulkPasteMapping,
} from "./bucketBulkPasteModel";

function bucket(name: string): BulkConfigClipboardBucket {
  return {
    name,
    quota: null,
    versioningEnabled: null,
    objectLock: null,
    publicAccessBlock: null,
    lifecycleRules: null,
    corsRules: null,
    policy: null,
    accessLogging: null,
  };
}

function clipboard(
  bucketNames: string[],
  overrides: Partial<BulkConfigClipboard> = {}
): BulkConfigClipboard {
  return {
    version: 1,
    copiedAt: "2026-08-28T00:00:00.000Z",
    sourceEndpointId: 7,
    sourceEndpointName: "Primary",
    features: {
      quota: true,
      versioning: false,
      object_lock: false,
      public_access_block: false,
      lifecycle: false,
      cors: false,
      policy: false,
      access_logging: false,
    },
    buckets: bucketNames.map(bucket),
    ...overrides,
  };
}

function buildPlan(
  overrides: Partial<Parameters<typeof buildBulkPastePlan>[0]> = {}
) {
  return buildBulkPastePlan({
    clipboard: clipboard(["source"]),
    destinationBucketNames: ["destination"],
    mapping: {},
    missingScopeHint: "Select an endpoint.",
    selectedEndpointId: 8,
    ...overrides,
  });
}

describe("bulk paste planning", () => {
  it("identifies the clipboard source endpoint", () => {
    const value = clipboard(["source"]);

    expect(isBulkClipboardSameEndpoint(value, 7)).toBe(true);
    expect(isBulkClipboardSameEndpoint(value, 8)).toBe(false);
    expect(isBulkClipboardSameEndpoint(null, 7)).toBe(false);
  });

  it("reports missing clipboard, scope, feature, source, and destination prerequisites", () => {
    expect(buildPlan({ clipboard: null }).error).toBe(
      "No copied configuration available."
    );
    expect(buildPlan({ selectedEndpointId: null }).error).toBe(
      "Select an endpoint."
    );
    expect(
      buildPlan({
        clipboard: clipboard(["source"], {
          features: {
            quota: false,
            versioning: false,
            object_lock: false,
            public_access_block: false,
            lifecycle: false,
            cors: false,
            policy: false,
            access_logging: false,
          },
        }),
      }).error
    ).toBe("Clipboard does not include any copied configuration.");
    expect(buildPlan({ clipboard: clipboard([]) }).error).toBe(
      "Copied selection is empty."
    );
    expect(buildPlan({ destinationBucketNames: [] }).error).toBe(
      "Select destination buckets first."
    );
  });

  it("maps one source to every destination except itself on the same endpoint", () => {
    const source = clipboard(["Source"]);
    const plan = buildPlan({
      clipboard: source,
      destinationBucketNames: ["Destination A", "Destination B"],
    });

    expect(plan).toEqual({
      mode: "one_to_many",
      mappings: [
        {
          sourceBucket: "Source",
          destinationBucket: "Destination A",
          sourceConfig: source.buckets[0],
        },
        {
          sourceBucket: "Source",
          destinationBucket: "Destination B",
          sourceConfig: source.buckets[0],
        },
      ],
      error: null,
    });
    expect(
      buildPlan({
        clipboard: source,
        destinationBucketNames: ["SOURCE"],
        selectedEndpointId: 7,
      })
    ).toMatchObject({
      mode: "one_to_many",
      mappings: [],
      error: "Copy/paste on the same bucket is not allowed: SOURCE.",
    });
  });

  it("validates complete one-to-one mappings", () => {
    const source = clipboard(["Source A", "Source B"]);

    expect(
      buildPlan({
        clipboard: source,
        destinationBucketNames: ["Destination A"],
      }).error
    ).toBe("Mapping impossible: source has 2 bucket(s), destination has 1.");
    expect(
      buildPlan({
        clipboard: source,
        destinationBucketNames: ["Destination A", "Destination B"],
        mapping: { "Source A": "Destination A" },
      }).error
    ).toBe("Complete the mapping for all source buckets (1 missing).");
    expect(
      buildPlan({
        clipboard: source,
        destinationBucketNames: ["Destination A", "Destination B"],
        mapping: { "Source A": "missing", "Source B": "Destination B" },
      }).error
    ).toBe("Some mapped destinations are invalid: missing.");
    expect(
      buildPlan({
        clipboard: source,
        destinationBucketNames: ["Destination A", "Destination B"],
        mapping: {
          "Source A": "Destination A",
          "Source B": "destination a",
        },
      }).error
    ).toBe("Each destination bucket can only be used once in 1:1 mapping.");
  });

  it("rejects same-bucket one-to-one mappings on one endpoint", () => {
    expect(
      buildPlan({
        clipboard: clipboard(["Source A", "Source B"]),
        destinationBucketNames: ["Source A", "Destination B"],
        mapping: {
          "Source A": "Source A",
          "Source B": "Destination B",
        },
        selectedEndpointId: 7,
      }).error
    ).toBe("Copy/paste on the same bucket is not allowed: Source A.");
  });

  it("builds canonical one-to-one mappings", () => {
    const source = clipboard(["Source A", "Source B"]);
    const plan = buildPlan({
      clipboard: source,
      destinationBucketNames: ["Destination A", "Destination B"],
      mapping: {
        "Source A": " destination b ",
        "Source B": "DESTINATION A",
      },
    });

    expect(plan.error).toBeNull();
    expect(plan.mappings.map((item) => [item.sourceBucket, item.destinationBucket])).toEqual([
      ["Source A", "Destination B"],
      ["Source B", "Destination A"],
    ]);
  });
});

describe("bulk paste mapping reconciliation", () => {
  it("automatically maps equal names across different endpoints", () => {
    expect(
      reconcileBulkPasteMapping({
        sourceBucketNames: ["Alpha", "Beta"],
        destinationBucketNames: ["beta", "ALPHA"],
        previousMapping: {},
        sameEndpoint: false,
      })
    ).toEqual({ Alpha: "ALPHA", Beta: "beta" });
  });

  it("keeps valid distinct choices and removes invalid or duplicate choices", () => {
    expect(
      reconcileBulkPasteMapping({
        sourceBucketNames: ["Alpha", "Beta"],
        destinationBucketNames: ["One", "Two"],
        previousMapping: { Alpha: " one ", Beta: "ONE", stale: "missing" },
        sameEndpoint: false,
      })
    ).toEqual({ Alpha: "One" });
  });

  it("does not automatically create forbidden same-endpoint mappings", () => {
    expect(
      reconcileBulkPasteMapping({
        sourceBucketNames: ["Alpha", "Beta"],
        destinationBucketNames: ["Alpha", "Beta"],
        previousMapping: {},
        sameEndpoint: true,
      })
    ).toEqual({});
  });

  it("clears obsolete mapping modes and preserves unchanged state references", () => {
    const emptyMapping = {};
    const validMapping = { Alpha: "Two", Beta: "One" };

    expect(
      reconcileBulkPasteMapping({
        sourceBucketNames: ["Alpha"],
        destinationBucketNames: ["One"],
        previousMapping: emptyMapping,
        sameEndpoint: false,
      })
    ).toBe(emptyMapping);
    expect(
      reconcileBulkPasteMapping({
        sourceBucketNames: ["Alpha", "Beta"],
        destinationBucketNames: ["One", "Two"],
        previousMapping: validMapping,
        sameEndpoint: true,
      })
    ).toBe(validMapping);
    expect(
      reconcileBulkPasteMapping({
        sourceBucketNames: ["Alpha"],
        destinationBucketNames: ["One", "Two"],
        previousMapping: { Alpha: "One" },
        sameEndpoint: false,
      })
    ).toEqual({});
  });
});
