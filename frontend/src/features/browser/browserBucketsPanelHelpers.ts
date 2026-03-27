/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import type { BrowserBucket } from "../../api/browser";

export type BucketAccessStatus = "unknown" | "checking" | "available" | "unavailable";

export type BucketAccessEntry = {
  status: BucketAccessStatus;
  detail: string | null;
};

export const UNKNOWN_BUCKET_ACCESS: BucketAccessEntry = {
  status: "unknown",
  detail: null,
};

export function splitBucketPanelBuckets(activeBucketName: string, items: BrowserBucket[]) {
  const currentBucket = activeBucketName
    ? items.find((bucket) => bucket.name === activeBucketName) ?? { name: activeBucketName, creation_date: null }
    : null;
  return {
    currentBucket,
    otherBuckets: activeBucketName ? items.filter((bucket) => bucket.name !== activeBucketName) : items,
  };
}

export function resolveBucketAccessEntry(
  bucketName: string,
  accessByBucket: Record<string, BucketAccessEntry>
): BucketAccessEntry {
  return accessByBucket[bucketName] ?? UNKNOWN_BUCKET_ACCESS;
}

export function sanitizeBucketAccessEntries(
  entries: Record<string, BucketAccessEntry>
): Record<string, BucketAccessEntry> {
  const next: Record<string, BucketAccessEntry> = {};
  Object.entries(entries).forEach(([bucketName, entry]) => {
    if (!entry) {
      return;
    }
    next[bucketName] =
      entry.status === "checking"
        ? { status: "unknown", detail: null }
        : {
            status: entry.status,
            detail: entry.detail ?? null,
          };
  });
  return next;
}
