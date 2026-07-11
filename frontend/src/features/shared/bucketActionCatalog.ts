/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */

export type BucketActionSurface = "ceph-admin" | "storage-ops";
export type BucketActionScope = "row" | "selection";
export type BucketActionGroup = "navigation" | "selection" | "s3" | "rgw" | "destructive-s3" | "destructive-rgw";

export type BucketActionId =
  | "open-browser"
  | "open-manager"
  | "configure-one"
  | "manage-tags"
  | "export-selection"
  | "configure-selection"
  | "check-integrity"
  | "calculate-stats"
  | "backup-configs"
  | "compare-buckets"
  | "check-index-one"
  | "check-index-selection"
  | "purge-contents"
  | "link-bucket"
  | "unlink-bucket"
  | "delete-bucket";

export type BucketActionDescriptor = {
  id: BucketActionId;
  label: string;
  group: BucketActionGroup;
  scopes: BucketActionScope[];
  surfaces: BucketActionSurface[];
  minSelection?: number;
  maxSelection?: number;
  danger?: boolean;
};

export const BUCKET_ACTION_GROUP_LABELS: Record<BucketActionGroup, string> = {
  navigation: "Open",
  selection: "Selection",
  s3: "S3 API",
  rgw: "RGW Admin Ops",
  "destructive-s3": "Destructive S3 operations",
  "destructive-rgw": "Destructive RGW Admin Ops",
};

export const BUCKET_ACTIONS: Record<BucketActionId, BucketActionDescriptor> = {
  "open-browser": { id: "open-browser", label: "Open in Browser", group: "navigation", scopes: ["row"], surfaces: ["ceph-admin"] },
  "open-manager": { id: "open-manager", label: "Open in Manager", group: "navigation", scopes: ["row"], surfaces: ["storage-ops"] },
  "configure-one": { id: "configure-one", label: "Configure bucket…", group: "s3", scopes: ["row"], surfaces: ["ceph-admin", "storage-ops"] },
  "manage-tags": { id: "manage-tags", label: "Manage UI tags…", group: "selection", scopes: ["selection"], surfaces: ["ceph-admin", "storage-ops"], minSelection: 1 },
  "export-selection": { id: "export-selection", label: "Export selection…", group: "selection", scopes: ["selection"], surfaces: ["ceph-admin", "storage-ops"], minSelection: 1 },
  "configure-selection": { id: "configure-selection", label: "Configure selected buckets…", group: "s3", scopes: ["selection"], surfaces: ["ceph-admin", "storage-ops"], minSelection: 1 },
  "check-integrity": { id: "check-integrity", label: "Check object integrity…", group: "s3", scopes: ["selection"], surfaces: ["ceph-admin", "storage-ops"], minSelection: 1 },
  "calculate-stats": { id: "calculate-stats", label: "Calculate usage stats…", group: "s3", scopes: ["selection"], surfaces: ["ceph-admin", "storage-ops"], minSelection: 1 },
  "backup-configs": { id: "backup-configs", label: "Back up bucket configurations…", group: "s3", scopes: ["selection"], surfaces: ["ceph-admin"], minSelection: 1 },
  "compare-buckets": { id: "compare-buckets", label: "Compare buckets…", group: "s3", scopes: ["selection"], surfaces: ["ceph-admin"], minSelection: 1 },
  "check-index-one": { id: "check-index-one", label: "Check bucket index…", group: "rgw", scopes: ["row"], surfaces: ["ceph-admin"] },
  "check-index-selection": { id: "check-index-selection", label: "Check bucket indexes…", group: "rgw", scopes: ["selection"], surfaces: ["ceph-admin"], minSelection: 1, maxSelection: 200 },
  "purge-contents": { id: "purge-contents", label: "Purge bucket contents…", group: "destructive-s3", scopes: ["selection"], surfaces: ["ceph-admin", "storage-ops"], minSelection: 1, danger: true },
  "link-bucket": { id: "link-bucket", label: "Link bucket…", group: "rgw", scopes: ["row"], surfaces: ["ceph-admin"] },
  "unlink-bucket": { id: "unlink-bucket", label: "Unlink bucket…", group: "destructive-rgw", scopes: ["row"], surfaces: ["ceph-admin"], danger: true },
  "delete-bucket": { id: "delete-bucket", label: "Delete bucket…", group: "destructive-rgw", scopes: ["row"], surfaces: ["ceph-admin"], danger: true },
};

export function bucketAction(id: BucketActionId): BucketActionDescriptor {
  return BUCKET_ACTIONS[id];
}
