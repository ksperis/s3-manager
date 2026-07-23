/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import {
  CEPH_ADMIN_PAGE_CONTRACTS,
  MANAGER_PAGE_CONTRACTS,
  WORKSPACE_CONTRACTS,
} from "../../../navigation/workspacePages";

export type BucketDetailMode = "manager" | "ceph-admin";

export type BucketDetailTabId =
  | "overview"
  | "objects"
  | "usage-stats"
  | "ceph"
  | "properties"
  | "permissions"
  | "advanced"
  | "metrics";

export type BucketDetailSurface = {
  mode: BucketDetailMode;
  rootPath: string;
  rootLabel: string;
  bucketListPath: string;
};

const BUCKET_DETAIL_SURFACES: Record<BucketDetailMode, BucketDetailSurface> = {
  manager: {
    mode: "manager",
    rootPath: WORKSPACE_CONTRACTS.manager.path,
    rootLabel: WORKSPACE_CONTRACTS.manager.label,
    bucketListPath: MANAGER_PAGE_CONTRACTS.buckets.path,
  },
  "ceph-admin": {
    mode: "ceph-admin",
    rootPath: WORKSPACE_CONTRACTS["ceph-admin"].path,
    rootLabel: WORKSPACE_CONTRACTS["ceph-admin"].label,
    bucketListPath: CEPH_ADMIN_PAGE_CONTRACTS.buckets.path,
  },
};

export function resolveBucketDetailSurface(mode: BucketDetailMode): BucketDetailSurface {
  return BUCKET_DETAIL_SURFACES[mode];
}

export function resolveBucketDetailTabs({
  mode,
  showObjectsTab,
  showQuotaTab,
}: {
  mode: BucketDetailMode;
  showObjectsTab: boolean;
  showQuotaTab: boolean;
}): BucketDetailTabId[] {
  if (mode === "ceph-admin") {
    return showObjectsTab
      ? ["overview", "objects", "ceph", "usage-stats", "properties", "permissions", "advanced", "metrics"]
      : ["overview", "ceph", "usage-stats", "properties", "permissions", "advanced", "metrics"];
  }
  const baseTabs: BucketDetailTabId[] = showObjectsTab
    ? ["overview", "objects", "usage-stats", "properties", "permissions", "advanced", "metrics"]
    : ["overview", "usage-stats", "properties", "permissions", "advanced", "metrics"];
  if (!showQuotaTab) return baseTabs;
  const insertAt = Math.max(1, baseTabs.indexOf("usage-stats"));
  return [...baseTabs.slice(0, insertAt), "ceph", ...baseTabs.slice(insertAt)];
}

export function buildBucketDetailBreadcrumbs(mode: BucketDetailMode, bucketName: string | null | undefined) {
  const surface = resolveBucketDetailSurface(mode);
  return [
    { label: surface.rootLabel, to: surface.rootPath },
    {
      label:
        mode === "manager"
          ? MANAGER_PAGE_CONTRACTS.buckets.label
          : CEPH_ADMIN_PAGE_CONTRACTS.buckets.label,
      to: surface.bucketListPath,
    },
    { label: bucketName ?? "" },
  ];
}
