/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import type { CephAdminBucket } from "../../api/cephAdmin";
import type { BucketListOrigin } from "./bucketListReturnContext";
import {
  getStorageOpsBucketName,
  getStorageOpsContextId,
} from "./bucketOpsPresentation";
import type { BucketOpsMode } from "./bucketOpsSurface";

export type BucketOpsNavigationAction = "configure" | "browser" | "manager";

type BucketOpsNavigationTarget = {
  pathname: string;
  search: string;
};

type BuildBucketOpsNavigationTargetInput = {
  action: BucketOpsNavigationAction;
  bucket: CephAdminBucket;
  mode: BucketOpsMode;
  selectedEndpointId: number | null | undefined;
};

function withSearchParams(
  pathname: string,
  values: Readonly<Record<string, string>>,
): BucketOpsNavigationTarget {
  const params = new URLSearchParams();
  Object.entries(values).forEach(([key, value]) => params.set(key, value));
  return { pathname, search: `?${params.toString()}` };
}

export function buildBucketOpsNavigationTarget({
  action,
  bucket,
  mode,
  selectedEndpointId,
}: BuildBucketOpsNavigationTargetInput): BucketOpsNavigationTarget | null {
  if (action === "browser") {
    if (mode !== "ceph-admin" || !selectedEndpointId) return null;
    return withSearchParams("/ceph-admin/browser", {
      ep: String(selectedEndpointId),
      bucket: bucket.name,
    });
  }

  if (mode === "ceph-admin") {
    if (action !== "configure" || !selectedEndpointId) return null;
    return withSearchParams(
      `/ceph-admin/buckets/${encodeURIComponent(bucket.name)}`,
      { ep: String(selectedEndpointId) },
    );
  }

  if (action !== "configure" && action !== "manager") return null;
  const contextId = getStorageOpsContextId(bucket);
  const bucketName = getStorageOpsBucketName(bucket);
  if (!contextId || !bucketName) return null;
  const surface = action === "configure" ? "storage-ops" : "manager";
  return withSearchParams(
    `/${surface}/buckets/${encodeURIComponent(bucketName)}`,
    { ctx: contextId },
  );
}

export function buildBucketOpsListOrigin({
  listUrl,
  mode,
  selectedEndpointId,
}: {
  listUrl: string;
  mode: BucketOpsMode;
  selectedEndpointId: number | null | undefined;
}): BucketListOrigin | null {
  if (!selectedEndpointId) return null;
  return {
    surface: mode,
    scopeKey:
      mode === "storage-ops" ? "storage-ops" : String(selectedEndpointId),
    listUrl,
  };
}
