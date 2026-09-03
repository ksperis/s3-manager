/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { describe, expect, it, vi } from "vitest";
import type {
  CephAdminBucket,
  ListCephAdminBucketsParams,
} from "../../api/cephAdminBuckets";
import { resolveBucketOpsSelectionTargets } from "./bucketOpsSelectionTargets";

describe("resolveBucketOpsSelectionTargets", () => {
  it("returns the requested names as missing when no scope is selected", async () => {
    const listBuckets = vi.fn();

    await expect(
      resolveBucketOpsSelectionTargets({
        bucketNames: ["alpha"],
        listBuckets,
        resolveTarget: () => null,
        scopeId: null,
      }),
    ).resolves.toEqual({ targets: [], missingNames: ["alpha"] });
    expect(listBuckets).not.toHaveBeenCalled();
  });

  it("loads names concurrently, deduplicates identities, and sorts targets", async () => {
    const bucketNames = Array.from(
      { length: 51 },
      (_, index) => `bucket-${index + 1}`,
    );
    const listBuckets = vi.fn(
      async (_scopeId: number, params: ListCephAdminBucketsParams) => {
        const filter = JSON.parse(params.advanced_filter ?? "{}") as {
          rules?: Array<{ value?: string[] }>;
        };
        const names = filter.rules?.[0]?.value ?? [];
        const items: CephAdminBucket[] = names
          .filter((name) => name !== "bucket-51")
          .map((name) => ({
            name,
            tenant: name === "bucket-1" ? "tenant-b" : null,
          }));
        return { items, has_next: false };
      },
    );
    const progress = vi.fn();

    const result = await resolveBucketOpsSelectionTargets({
      bucketNames,
      listBuckets,
      onProgress: progress,
      resolveTarget: (bucket) => ({
        key:
          bucket.name === "bucket-2"
            ? "shared-key"
            : bucket.name === "bucket-3"
              ? "shared-key"
              : `${bucket.tenant ?? ""}:${bucket.name}`,
        name: bucket.name,
        tenant: bucket.tenant ?? null,
      }),
      scopeId: 7,
    });

    expect(listBuckets).toHaveBeenCalledTimes(2);
    expect(listBuckets).toHaveBeenCalledWith(
      7,
      expect.objectContaining({ with_stats: false }),
    );
    expect(progress).toHaveBeenCalledTimes(2);
    expect(result.missingNames).toEqual(["bucket-51"]);
    expect(result.targets).toHaveLength(49);
    expect(result.targets.map((target) => target.name)).toEqual(
      [...result.targets.map((target) => target.name)].sort((left, right) =>
        left.localeCompare(right),
      ),
    );
    expect(result.targets.find((target) => target.key === "shared-key")?.name).toBe(
      "bucket-3",
    );
  });

  it("treats buckets without a canonical target as unresolved", async () => {
    const listBuckets = vi.fn(async () => ({
      items: [{ name: "alpha" }, { name: "beta" }],
      has_next: false,
    }));

    const result = await resolveBucketOpsSelectionTargets({
      bucketNames: ["alpha", "beta"],
      listBuckets,
      resolveTarget: (bucket) =>
        bucket.name === "alpha"
          ? { key: "alpha", name: "alpha", tenant: null }
          : null,
      scopeId: 7,
    });

    expect(result).toEqual({
      targets: [{ key: "alpha", name: "alpha", tenant: null }],
      missingNames: ["beta"],
    });
  });
});
