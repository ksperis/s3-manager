/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
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
    rootPath: "/manager",
    rootLabel: "Manager",
    bucketListPath: "/manager/buckets",
  },
  "ceph-admin": {
    mode: "ceph-admin",
    rootPath: "/ceph-admin",
    rootLabel: "Ceph Admin",
    bucketListPath: "/ceph-admin/buckets",
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
    { label: "Buckets", to: surface.bucketListPath },
    { label: bucketName ?? "" },
  ];
}
