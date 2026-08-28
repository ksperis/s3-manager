/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { runWithConcurrencySettled } from "../../utils/concurrency";
import { extractApiError } from "../../utils/apiError";
import {
  BULK_CONCURRENCY_LIMIT,
  type BulkPreviewItem,
} from "./bucketBulkOperationsModel";

type BucketPreviewBatchInput<Item> = {
  buildFailure: (item: Item, error: string) => BulkPreviewItem;
  items: readonly Item[];
  onProgress?: (progress: { completed: number; total: number; failed: number }) => void;
  preview: (item: Item) => Promise<BulkPreviewItem>;
};

export async function runBucketPreviewBatch<Item>({
  buildFailure,
  items,
  onProgress,
  preview,
}: BucketPreviewBatchInput<Item>): Promise<BulkPreviewItem[]> {
  let completed = 0;
  let failed = 0;
  const total = items.length;
  const results = await runWithConcurrencySettled(
    [...items],
    BULK_CONCURRENCY_LIMIT,
    preview,
    (result) => {
      completed += 1;
      if (result.status === "rejected") failed += 1;
      onProgress?.({ completed: Math.min(total, completed), total, failed });
    },
  );

  return results.map((result, index) =>
    result.status === "fulfilled"
      ? result.value
      : buildFailure(
          items[index],
          extractApiError(result.reason, "Unexpected error"),
        ),
  );
}
