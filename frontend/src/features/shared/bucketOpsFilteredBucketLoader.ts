/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import type {
  CephAdminBucket,
  ListCephAdminBucketsParams,
} from "../../api/cephAdminBuckets";

type BucketOpsFilteredBucketPage = {
  items?: CephAdminBucket[];
  has_next: boolean;
  total?: number;
};

type BucketOpsFilteredBucketLoaderInput = {
  initialTotal?: number | null;
  listBuckets: (
    scopeId: number,
    params: ListCephAdminBucketsParams,
  ) => Promise<BucketOpsFilteredBucketPage>;
  onProgress?: (completed: number, total: number) => void;
  params: Omit<ListCephAdminBucketsParams, "page" | "page_size">;
  scopeId: number;
};

export async function loadBucketOpsFilteredBuckets({
  initialTotal = null,
  listBuckets,
  onProgress,
  params,
  scopeId,
}: BucketOpsFilteredBucketLoaderInput): Promise<Map<string, CephAdminBucket>> {
  const bucketsByName = new Map<string, CephAdminBucket>();
  let expectedTotal = initialTotal !== null && initialTotal >= 0 ? initialTotal : null;
  let nextPage = 1;

  while (true) {
    const response = await listBuckets(scopeId, {
      ...params,
      page: nextPage,
      page_size: 200,
    });
    (response.items ?? []).forEach((bucket) => bucketsByName.set(bucket.name, bucket));
    if (typeof response.total === "number" && response.total >= 0) {
      expectedTotal = response.total;
    }

    const progressTotal = expectedTotal ?? bucketsByName.size;
    onProgress?.(Math.min(bucketsByName.size, progressTotal), progressTotal);

    if (!response.has_next) break;
    if (expectedTotal !== null && bucketsByName.size >= expectedTotal) break;
    nextPage += 1;
  }

  return bucketsByName;
}
