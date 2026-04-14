/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */

export type BucketListingTransportParams = {
  page?: number;
  page_size?: number;
  filter?: string;
  advanced_filter?: string;
  sort_by?: string;
  sort_dir?: "asc" | "desc";
  include?: string[];
  with_stats?: boolean;
};

// Stay well below common proxy/browser URL limits when advanced_filter expands
// into large exact-match bucket lists.
export const BUCKET_LISTING_POST_QUERY_THRESHOLD = 4000;

export function buildBucketListingQuery(params?: BucketListingTransportParams): URLSearchParams {
  const query = new URLSearchParams();
  if (!params) return query;
  if (params.page !== undefined) query.set("page", String(params.page));
  if (params.page_size !== undefined) query.set("page_size", String(params.page_size));
  if (typeof params.filter === "string" && params.filter.trim().length > 0) query.set("filter", params.filter);
  if (typeof params.advanced_filter === "string" && params.advanced_filter.trim().length > 0) {
    query.set("advanced_filter", params.advanced_filter);
  }
  if (typeof params.sort_by === "string" && params.sort_by.trim().length > 0) query.set("sort_by", params.sort_by);
  if (typeof params.sort_dir === "string" && params.sort_dir.trim().length > 0) query.set("sort_dir", params.sort_dir);
  if (Array.isArray(params.include) && params.include.length > 0) query.set("include", params.include.join(","));
  if (params.with_stats !== undefined) query.set("with_stats", params.with_stats ? "true" : "false");
  return query;
}

export function shouldUsePostBucketListing(params?: BucketListingTransportParams): boolean {
  return buildBucketListingQuery(params).toString().length > BUCKET_LISTING_POST_QUERY_THRESHOLD;
}

export function buildBucketListingRequestBody(
  params?: BucketListingTransportParams
): BucketListingTransportParams | undefined {
  if (!params) return undefined;
  return {
    page: params.page,
    page_size: params.page_size,
    filter: typeof params.filter === "string" && params.filter.trim().length > 0 ? params.filter : undefined,
    advanced_filter:
      typeof params.advanced_filter === "string" && params.advanced_filter.trim().length > 0
        ? params.advanced_filter
        : undefined,
    sort_by: typeof params.sort_by === "string" && params.sort_by.trim().length > 0 ? params.sort_by : undefined,
    sort_dir: typeof params.sort_dir === "string" && params.sort_dir.trim().length > 0 ? params.sort_dir : undefined,
    include: Array.isArray(params.include) && params.include.length > 0 ? params.include : undefined,
    with_stats: params.with_stats,
  };
}
