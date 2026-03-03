/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import type { BrowserBucket } from "../../api/browser";

export const BROWSER_QUERY_DEBOUNCE_MS = 250;

export const mergeBucketSearchItems = (
  previous: BrowserBucket[],
  incoming: BrowserBucket[],
  append: boolean
): BrowserBucket[] => {
  if (!append) {
    return incoming;
  }
  const names = new Set(previous.map((bucket) => bucket.name));
  return [...previous, ...incoming.filter((bucket) => !names.has(bucket.name))];
};

export const prepareLatestRequest = (previous: AbortController | null, latestSeq: number) => {
  previous?.abort();
  return {
    requestSeq: latestSeq + 1,
    controller: new AbortController(),
  };
};

export const isStaleRequest = (requestSeq: number, latestSeq: number) => requestSeq !== latestSeq;
