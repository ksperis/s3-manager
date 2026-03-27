/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import axios from "axios";
import type { BrowserBucket } from "../../api/browser";
import { extractApiError } from "../../utils/apiError";

export type BucketAccessStatus = "unknown" | "checking" | "available" | "unavailable";

export type BucketAccessEntry = {
  status: BucketAccessStatus;
  detail: string | null;
};

export type BrowserListingIssue = {
  kind: "access_denied" | "request_failed";
  title: string;
  description: string;
  technicalDetail: string;
};

export const UNKNOWN_BUCKET_ACCESS: BucketAccessEntry = {
  status: "unknown",
  detail: null,
};

const ACCESS_DENIED_PATTERN = /\b(accessdenied|forbidden)\b/i;

export function normalizeBrowserListingIssue(
  error: unknown,
  fallbackTechnicalDetail: string
): BrowserListingIssue {
  const technicalDetail = extractApiError(error, fallbackTechnicalDetail);
  const statusCode = axios.isAxiosError(error) ? error.response?.status : undefined;
  const accessDenied = statusCode === 403 || ACCESS_DENIED_PATTERN.test(technicalDetail);

  if (accessDenied) {
    return {
      kind: "access_denied",
      title: "Listing is not available for this bucket.",
      description: "The current credentials cannot list objects or folders in this bucket.",
      technicalDetail,
    };
  }

  return {
    kind: "request_failed",
    title: "Unable to load objects for this bucket.",
    description: "Retry in a moment.",
    technicalDetail,
  };
}

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
