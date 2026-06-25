import { describe, expect, it } from "vitest";

import {
  buildBucketDetailBreadcrumbs,
  resolveBucketDetailSurface,
  resolveBucketDetailTabs,
} from "../bucketDetailSurface";

describe("bucketDetailSurface", () => {
  it("keeps Manager bucket detail tabs object-first with optional Ceph quota", () => {
    expect(resolveBucketDetailTabs({ mode: "manager", showObjectsTab: true, showQuotaTab: false })).toEqual([
      "overview",
      "objects",
      "usage-stats",
      "properties",
      "permissions",
      "advanced",
      "metrics",
    ]);
    expect(resolveBucketDetailTabs({ mode: "manager", showObjectsTab: true, showQuotaTab: true })).toEqual([
      "overview",
      "objects",
      "ceph",
      "usage-stats",
      "properties",
      "permissions",
      "advanced",
      "metrics",
    ]);
  });

  it("keeps Ceph Admin bucket detail endpoint-scoped and hides object browsing", () => {
    expect(resolveBucketDetailTabs({ mode: "ceph-admin", showObjectsTab: true, showQuotaTab: true })).toEqual([
      "overview",
      "ceph",
      "usage-stats",
      "properties",
      "permissions",
      "advanced",
      "metrics",
    ]);
    expect(resolveBucketDetailSurface("ceph-admin")).toMatchObject({
      rootPath: "/ceph-admin",
      rootLabel: "Ceph Admin",
      bucketListPath: "/ceph-admin/buckets",
    });
  });

  it("builds breadcrumbs without mixing Manager and Ceph Admin routes", () => {
    expect(buildBucketDetailBreadcrumbs("manager", "photos")).toEqual([
      { label: "Manager", to: "/manager" },
      { label: "Buckets", to: "/manager/buckets" },
      { label: "photos" },
    ]);
    expect(buildBucketDetailBreadcrumbs("ceph-admin", "photos")).toEqual([
      { label: "Ceph Admin", to: "/ceph-admin" },
      { label: "Buckets", to: "/ceph-admin/buckets" },
      { label: "photos" },
    ]);
  });
});
