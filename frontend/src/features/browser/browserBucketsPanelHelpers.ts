/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { isApiError } from "../../api/client";
import type { BrowserBucket } from "../../api/browserContracts";
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
const BUCKET_LIST_ACCESS_DENIED_MESSAGE =
  "The current account is not allowed to list buckets. You can still open a bucket you have access to directly, or ask an administrator to update your permissions.";
const STORAGE_SPACE_LIST_ACCESS_DENIED_MESSAGE =
  "The current account is not allowed to list Storage Spaces. Ask an administrator to update your access.";

const isBucketListAccessDeniedMessage = (message: string) => {
  const normalized = message.toLowerCase();
  const compact = normalized.replace(/\s+/g, "");
  return (
    compact.includes("accessdenied") &&
    (compact.includes("listbuckets") ||
      normalized.includes("list buckets") ||
      normalized.includes("unable to list buckets"))
  );
};

export const extractBucketListError = (
  error: unknown,
  useStorageSpaceVocabulary: boolean,
) => {
  const message = extractApiError(
    error,
    "Unable to list buckets for this account.",
  );
  if (!isBucketListAccessDeniedMessage(message)) return message;
  return useStorageSpaceVocabulary
    ? STORAGE_SPACE_LIST_ACCESS_DENIED_MESSAGE
    : BUCKET_LIST_ACCESS_DENIED_MESSAGE;
};

export function normalizeBrowserListingIssue(
  error: unknown,
  fallbackTechnicalDetail: string
): BrowserListingIssue {
  const technicalDetail = extractApiError(error, fallbackTechnicalDetail);
  const statusCode = isApiError(error) ? error.response?.status : undefined;
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
