import { beforeEach, describe, expect, it } from "vitest";
import {
  applyPublicAccessBlockTargets,
  formatPublicAccessBlockState,
  loadBulkConfigClipboard,
  normalizeAccessLoggingSnapshot,
  normalizeObjectLockSnapshot,
  normalizePublicAccessBlockState,
  parseQuotaInput,
  persistBulkConfigClipboard,
  runWithConcurrencySettled,
} from "./bucketBulkOperationsModel";

beforeEach(() => sessionStorage.clear());

describe("bucketBulkOperationsModel", () => {
  it("parses selected quota dimensions and normalizes zero as no limit", () => {
    expect(parseQuotaInput("1.5", "GiB", "250", true, true)).toEqual({
      applySize: true,
      applyObjects: true,
      maxSizeValue: 1.5,
      maxSizeUnit: "GiB",
      maxSizeBytes: 1.5 * 1024 ** 3,
      maxObjects: 250,
    });
    expect(parseQuotaInput("0", "MiB", "", true, false)).toMatchObject({
      maxSizeBytes: null,
      maxObjects: null,
    });
  });

  it("rejects missing targets and invalid quota values", () => {
    expect(parseQuotaInput("", "GiB", "", false, false)).toEqual({
      error: "Select at least one quota target (storage or objects).",
    });
    expect(parseQuotaInput("-1", "GiB", "", true, false)).toHaveProperty(
      "error",
    );
    expect(parseQuotaInput("", "GiB", "1.5", false, true)).toHaveProperty(
      "error",
    );
  });

  it("normalizes and updates only selected public-access-block flags", () => {
    const current = normalizePublicAccessBlockState({
      block_public_acls: true,
      block_public_policy: true,
    });
    const updated = applyPublicAccessBlockTargets(current, true, [
      "ignore_public_acls",
    ]);

    expect(updated).toEqual({
      block_public_acls: true,
      ignore_public_acls: true,
      block_public_policy: true,
      restrict_public_buckets: false,
    });
    expect(formatPublicAccessBlockState(updated)).toBe("Partial (3/4)");
  });

  it("normalizes object-lock and access-logging snapshots", () => {
    expect(
      normalizeObjectLockSnapshot({
        enabled: 1,
        mode: " GOVERNANCE ",
        days: 30,
        years: Number.NaN,
      }),
    ).toEqual({
      enabled: true,
      mode: "GOVERNANCE",
      days: 30,
      years: null,
    });
    expect(
      normalizeAccessLoggingSnapshot({
        enabled: true,
        target_bucket: " logs ",
        target_prefix: " access/ ",
      }),
    ).toEqual({
      enabled: true,
      target_bucket: "logs",
      target_prefix: "access/",
    });
    expect(normalizeAccessLoggingSnapshot({ enabled: true })).toEqual({
      enabled: false,
      target_bucket: null,
      target_prefix: null,
    });
  });

  it("loads and sanitizes the persisted configuration clipboard", () => {
    sessionStorage.setItem(
      "clipboard",
      JSON.stringify({
        version: 1,
        copiedAt: "2026-08-02T10:00:00.000Z",
        sourceEndpointId: "4",
        sourceEndpointName: " Primary ",
        features: { quota: true, cors: "yes" },
        buckets: [
          null,
          { name: "" },
          {
            name: " Logs ",
            quota: { maxSizeBytes: 0, maxObjects: 12 },
            versioningEnabled: true,
            objectLock: { enabled: true, mode: " GOVERNANCE ", days: 30 },
            publicAccessBlock: { block_public_acls: true },
            lifecycleRules: [{ ID: "expire" }, null, []],
            corsRules: "invalid",
            policy: [],
            accessLogging: {
              enabled: true,
              target_bucket: " target ",
              target_prefix: " logs/ ",
            },
          },
        ],
      }),
    );

    expect(loadBulkConfigClipboard("clipboard")).toEqual({
      version: 1,
      copiedAt: "2026-08-02T10:00:00.000Z",
      sourceEndpointId: 4,
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
      buckets: [
        {
          name: "Logs",
          quota: { maxSizeBytes: null, maxObjects: 12 },
          versioningEnabled: true,
          objectLock: { enabled: true, mode: "GOVERNANCE", days: 30, years: null },
          publicAccessBlock: {
            block_public_acls: true,
            ignore_public_acls: false,
            block_public_policy: false,
            restrict_public_buckets: false,
          },
          lifecycleRules: [{ ID: "expire" }],
          corsRules: null,
          policy: null,
          accessLogging: {
            enabled: true,
            target_bucket: "target",
            target_prefix: "logs/",
          },
        },
      ],
    });
  });

  it("persists and clears the configuration clipboard", () => {
    sessionStorage.setItem(
      "source",
      JSON.stringify({
        version: 1,
        copiedAt: "2026-08-02T10:00:00.000Z",
        sourceEndpointId: 4,
        features: {},
        buckets: [{ name: "logs" }],
      }),
    );
    const clipboard = loadBulkConfigClipboard("source");
    expect(clipboard).not.toBeNull();

    persistBulkConfigClipboard("target", clipboard);
    expect(JSON.parse(sessionStorage.getItem("target") ?? "null")).toEqual(clipboard);

    persistBulkConfigClipboard("target", null);
    expect(sessionStorage.getItem("target")).toBeNull();
  });

  it("ignores versionless and unsupported clipboard formats", () => {
    const clipboard = {
      copiedAt: "2026-08-02T10:00:00.000Z",
      sourceEndpointId: 4,
      features: {},
      buckets: [{ name: "logs" }],
    };
    sessionStorage.setItem("versionless", JSON.stringify(clipboard));
    sessionStorage.setItem("future", JSON.stringify({ ...clipboard, version: 2 }));

    expect(loadBulkConfigClipboard("versionless")).toBeNull();
    expect(loadBulkConfigClipboard("future")).toBeNull();
  });

  it("settles work with bounded concurrency while preserving result order", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const settledIndexes: number[] = [];

    const results = await runWithConcurrencySettled(
      [1, 2, 3, 4, 5],
      2,
      async (value) => {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await Promise.resolve();
        inFlight -= 1;
        if (value === 3) throw new Error("failed");
        return value * 10;
      },
      (_result, index) => settledIndexes.push(index),
    );

    expect(maxInFlight).toBe(2);
    expect(results.map(({ status }) => status)).toEqual([
      "fulfilled",
      "fulfilled",
      "rejected",
      "fulfilled",
      "fulfilled",
    ]);
    expect(results[0]).toEqual({ status: "fulfilled", value: 10 });
    expect(results[2]).toMatchObject({ status: "rejected" });
    expect(settledIndexes).toHaveLength(5);
  });
});
