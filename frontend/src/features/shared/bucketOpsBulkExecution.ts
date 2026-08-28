/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { runWithConcurrencySettled } from "../../utils/concurrency";
import { BULK_CONCURRENCY_LIMIT } from "./bucketBulkOperationsModel";

type BucketMutationProgress = {
  completed: number;
  total: number;
  failed: number;
};

export type BucketMutationBatchResult = {
  changedCount: number;
  unchangedCount: number;
  failedCount: number;
  error: string | null;
  summary: string;
};

type BucketMutationBatchInput<Item> = {
  items: readonly Item[];
  mutate: (item: Item) => Promise<{ changed: boolean }>;
  onProgress?: (progress: BucketMutationProgress) => void;
};

export async function runBucketMutationBatch<Item>({
  items,
  mutate,
  onProgress,
}: BucketMutationBatchInput<Item>): Promise<BucketMutationBatchResult> {
  let completed = 0;
  let failed = 0;
  const total = items.length;
  const results = await runWithConcurrencySettled(
    [...items],
    BULK_CONCURRENCY_LIMIT,
    mutate,
    (result) => {
      completed += 1;
      if (result.status === "rejected") failed += 1;
      onProgress?.({ completed: Math.min(total, completed), total, failed });
    },
  );

  const changedCount = results.filter(
    (result): result is PromiseFulfilledResult<{ changed: boolean }> =>
      result.status === "fulfilled" && result.value.changed,
  ).length;
  const unchangedCount = results.filter(
    (result): result is PromiseFulfilledResult<{ changed: boolean }> =>
      result.status === "fulfilled" && !result.value.changed,
  ).length;

  return {
    changedCount,
    unchangedCount,
    failedCount: failed,
    error: failed > 0 ? `${failed} bucket(s) failed to update.` : null,
    summary: `Updated ${changedCount} bucket${changedCount !== 1 ? "s" : ""}${
      unchangedCount > 0 ? ` (${unchangedCount} unchanged)` : ""
    }.`,
  };
}
