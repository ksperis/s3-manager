/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
export type CephAdminEntityListingParams = {
  page?: number;
  page_size?: number;
  search?: string;
  advanced_filter?: string;
  sort_by?: string;
  sort_dir?: "asc" | "desc";
  include?: string[];
};

export type CephAdminEntityListingRequestOptions = {
  signal?: AbortSignal;
};

export type CephAdminListingStreamProgress = {
  request_id: string;
  percent: number;
  stage: string;
  processed: number;
  total: number;
  message?: string;
};

export type CephAdminListingStreamOptions = {
  signal?: AbortSignal;
  onProgress?: (event: CephAdminListingStreamProgress) => void;
};

export function buildCephAdminEntityListingQuery(
  params?: CephAdminEntityListingParams,
): URLSearchParams {
  const query = new URLSearchParams();
  if (!params) return query;
  if (typeof params.page === "number") query.set("page", String(params.page));
  if (typeof params.page_size === "number") {
    query.set("page_size", String(params.page_size));
  }
  if (typeof params.search === "string" && params.search.trim()) {
    query.set("search", params.search);
  }
  if (
    typeof params.advanced_filter === "string" &&
    params.advanced_filter.trim()
  ) {
    query.set("advanced_filter", params.advanced_filter);
  }
  if (typeof params.sort_by === "string" && params.sort_by.trim()) {
    query.set("sort_by", params.sort_by);
  }
  if (params.sort_dir) query.set("sort_dir", params.sort_dir);
  if (params.include && params.include.length > 0) {
    query.set("include", params.include.join(","));
  }
  return query;
}
