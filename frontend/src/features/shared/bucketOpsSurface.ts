/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
export type BucketOpsMode = "ceph-admin" | "storage-ops";

export type BucketOpsSurfaceContract = {
  mode: BucketOpsMode;
  breadcrumb: { label: string; to: string };
  storageKeys: {
    columns: string;
    bucketListState: string;
    bulkConfigClipboard: string;
  };
  defaultVisibleColumns: readonly string[];
  useExplicitBucketName: boolean;
  scopeDisplayName: string;
  exportPrefix: string;
  exportScopeKey: "endpoint" | "scope";
  missingScopeError: string;
  missingScopeHint: string;
};

const BUCKET_OPS_SURFACES: Record<BucketOpsMode, BucketOpsSurfaceContract> = {
  "ceph-admin": {
    mode: "ceph-admin",
    breadcrumb: { label: "Ceph Admin", to: "/ceph-admin" },
    storageKeys: {
      columns: "ceph-admin.bucket_list.columns.v2",
      bucketListState: "ceph-admin.bucket_list.state.v1",
      bulkConfigClipboard: "ceph-admin.bucket_list.bulk_config_clipboard.v2",
    },
    defaultVisibleColumns: ["ui_tags", "owner", "used_bytes", "object_count"],
    useExplicitBucketName: false,
    scopeDisplayName: "Endpoint",
    exportPrefix: "ceph-admin",
    exportScopeKey: "endpoint",
    missingScopeError: "No endpoint selected.",
    missingScopeHint: "Select an endpoint first.",
  },
  "storage-ops": {
    mode: "storage-ops",
    breadcrumb: { label: "Storage Ops", to: "/storage-ops" },
    storageKeys: {
      columns: "storage-ops.bucket_list.columns.v2",
      bucketListState: "storage-ops.bucket_list.state.v1",
      bulkConfigClipboard: "storage-ops.bucket_list.bulk_config_clipboard.v2",
    },
    defaultVisibleColumns: ["context_name", "ui_tags", "used_bytes", "object_count"],
    useExplicitBucketName: true,
    scopeDisplayName: "Scope",
    exportPrefix: "storage-ops",
    exportScopeKey: "scope",
    missingScopeError: "No Storage Ops scope selected.",
    missingScopeHint: "Select a scope first.",
  },
};

export function resolveBucketOpsSurface(mode: BucketOpsMode): BucketOpsSurfaceContract {
  return BUCKET_OPS_SURFACES[mode];
}
