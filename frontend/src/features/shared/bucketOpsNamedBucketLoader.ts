/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import type {
  CephAdminBucket,
  ListCephAdminBucketsParams,
} from "../../api/cephAdmin";
import { runWithConcurrencySettled } from "../../utils/concurrency";

type BucketOpsNamedBucketPage = {
  items?: CephAdminBucket[];
  has_next: boolean;
};

type BucketOpsNamedBucketLoaderInput = {
  bucketNames: readonly string[];
  concurrency?: number;
  include?: string[];
  listBuckets: (
    scopeId: number,
    params: ListCephAdminBucketsParams,
  ) => Promise<BucketOpsNamedBucketPage>;
  onProgress?: (progress: { completed: number; total: number; failed: number }) => void;
  scopeId: number;
  withStats: boolean;
};

export async function loadBucketOpsBucketsByNames({
  bucketNames,
  concurrency = 1,
  include,
  listBuckets,
  onProgress,
  scopeId,
  withStats,
}: BucketOpsNamedBucketLoaderInput): Promise<Map<string, CephAdminBucket>> {
  if (bucketNames.length === 0) return new Map();

  const chunkSize = 50;
  const chunks: string[][] = [];
  for (let start = 0; start < bucketNames.length; start += chunkSize) {
    chunks.push(bucketNames.slice(start, start + chunkSize));
  }

  let completed = 0;
  let failed = 0;
  const total = bucketNames.length;
  const chunkResults = await runWithConcurrencySettled(
    chunks,
    concurrency,
    async (chunk) => {
      const buckets: CephAdminBucket[] = [];
      const advancedFilter = JSON.stringify({
        match: "any",
        rules: [{ field: "name", op: "in", value: chunk }],
      });
      let nextPage = 1;
      while (true) {
        const response = await listBuckets(scopeId, {
          page: nextPage,
          page_size: 200,
          advanced_filter: advancedFilter,
          include: include && include.length > 0 ? include : undefined,
          with_stats: withStats,
        });
        buckets.push(...(response.items ?? []));
        if (!response.has_next) break;
        nextPage += 1;
      }
      return buckets;
    },
    (result, index) => {
      const chunkLength = chunks[index]?.length ?? 0;
      completed += chunkLength;
      if (result.status === "rejected") failed += chunkLength;
      onProgress?.({ completed: Math.min(total, completed), total, failed });
    },
  );

  const rejectedChunk = chunkResults.find((result) => result.status === "rejected");
  if (rejectedChunk?.status === "rejected") throw rejectedChunk.reason;

  const bucketsByName = new Map<string, CephAdminBucket>();
  chunkResults
    .filter((result): result is PromiseFulfilledResult<CephAdminBucket[]> => result.status === "fulfilled")
    .flatMap((result) => result.value)
    .forEach((bucket) => bucketsByName.set(bucket.name, bucket));
  return bucketsByName;
}
