/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { describe, expect, it, vi } from "vitest";
import type { CephAdminBucket, ListCephAdminBucketsParams } from "../../api/cephAdmin";
import { loadBucketOpsBucketsByNames } from "./bucketOpsNamedBucketLoader";

const bucket = (name: string): CephAdminBucket => ({ name });

const requestedNames = (params: ListCephAdminBucketsParams): string[] => {
  const payload = JSON.parse(params.advanced_filter ?? "{}") as {
    rules?: Array<{ value?: unknown }>;
  };
  const value = payload.rules?.[0]?.value;
  return Array.isArray(value) ? value.map(String) : [];
};

describe("loadBucketOpsBucketsByNames", () => {
  it("chunks names, paginates each chunk, and reports settled progress", async () => {
    const names = Array.from({ length: 55 }, (_, index) => `bucket-${index + 1}`);
    const progress: Array<{ completed: number; total: number; failed: number }> = [];
    const listBuckets = vi.fn(
      async (_scopeId: number, params: ListCephAdminBucketsParams) => {
        const chunk = requestedNames(params);
        if (chunk.length === 50 && params.page === 1) {
          return { items: chunk.slice(0, 49).map(bucket), has_next: true };
        }
        if (chunk.length === 50) {
          return { items: [bucket(chunk[49])], has_next: false };
        }
        return {
          items: [...chunk.map(bucket), bucket(chunk[0])],
          has_next: false,
        };
      },
    );

    const result = await loadBucketOpsBucketsByNames({
      bucketNames: names,
      concurrency: 1,
      include: ["quota"],
      listBuckets,
      onProgress: (event) => progress.push(event),
      scopeId: 7,
      withStats: true,
    });

    expect(result.size).toBe(55);
    expect(result.get("bucket-55")).toEqual(bucket("bucket-55"));
    expect(listBuckets).toHaveBeenCalledTimes(3);
    expect(listBuckets).toHaveBeenNthCalledWith(
      1,
      7,
      expect.objectContaining({ page: 1, page_size: 200, include: ["quota"], with_stats: true }),
    );
    expect(listBuckets).toHaveBeenNthCalledWith(
      2,
      7,
      expect.objectContaining({ page: 2 }),
    );
    expect(progress).toEqual([
      { completed: 50, total: 55, failed: 0 },
      { completed: 55, total: 55, failed: 0 },
    ]);
  });

  it("settles remaining chunks, reports failures, and rethrows the first error", async () => {
    const failure = new Error("listing failed");
    const names = Array.from({ length: 51 }, (_, index) => `bucket-${index + 1}`);
    const progress: Array<{ completed: number; total: number; failed: number }> = [];
    const listBuckets = vi.fn(
      async (_scopeId: number, params: ListCephAdminBucketsParams) => {
        const chunk = requestedNames(params);
        if (chunk.length === 50) throw failure;
        return { items: chunk.map(bucket), has_next: false };
      },
    );

    await expect(
      loadBucketOpsBucketsByNames({
        bucketNames: names,
        concurrency: 1,
        listBuckets,
        onProgress: (event) => progress.push(event),
        scopeId: 7,
        withStats: false,
      }),
    ).rejects.toBe(failure);

    expect(listBuckets).toHaveBeenCalledTimes(2);
    expect(progress).toEqual([
      { completed: 50, total: 51, failed: 50 },
      { completed: 51, total: 51, failed: 50 },
    ]);
  });

  it("returns immediately for an empty selection", async () => {
    const listBuckets = vi.fn();

    await expect(
      loadBucketOpsBucketsByNames({
        bucketNames: [],
        listBuckets,
        scopeId: 7,
        withStats: false,
      }),
    ).resolves.toEqual(new Map());
    expect(listBuckets).not.toHaveBeenCalled();
  });
});
