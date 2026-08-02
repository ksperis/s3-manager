import { describe, expect, it } from "vitest";
import type { RouteObject } from "react-router-dom";

import { createAppRoutes } from "./router";

function joinRoutePath(base: string, path: string): string {
  if (path.startsWith("/")) return path;
  const normalizedBase = base === "/" ? "" : base;
  return `${normalizedBase}/${path}`.replace(/\/+/g, "/");
}

function collectRoutePaths(routes: RouteObject[], base = ""): string[] {
  return routes.flatMap((route) => {
    const current = route.path ? joinRoutePath(base || "/", route.path) : base || "/";
    const own = route.index ? [`${current}#index`] : route.path ? [current] : [];
    return [...own, ...collectRoutePaths(route.children ?? [], current)];
  });
}

describe("route snapshot", () => {
  it("preserves the public frontend route contract", () => {
    expect(collectRoutePaths(createAppRoutes())).toEqual([
      "/#index",
      "/profile",
      "/admin",
      "/admin#index",
      "/admin/profile",
      "/admin/s3-accounts",
      "/admin/accounts",
      "/admin/s3-users",
      "/admin/s3-connections",
      "/admin/s3-users/:userId/keys",
      "/admin/storage-endpoints",
      "/admin/storage-endpoints/:endpointId",
      "/admin/endpoint-status",
      "/admin/endpoint-status/:endpointId",
      "/admin/users",
      "/admin/groups",
      "/admin/audit",
      "/admin/metrics",
      "/admin/portal-requests",
      "/admin/billing",
      "/admin/usage-history",
      "/admin/general-settings",
      "/admin/authentication-settings",
      "/admin/manager-settings",
      "/admin/portal-settings",
      "/admin/browser-settings",
      "/admin/key-rotation",
      "/admin/api-tokens",
      "/ceph-admin",
      "/ceph-admin#index",
      "/ceph-admin/profile",
      "/ceph-admin/metrics",
      "/ceph-admin/accounts",
      "/ceph-admin/users",
      "/ceph-admin/buckets",
      "/ceph-admin/buckets/:bucketName",
      "/ceph-admin/browser",
      "/storage-ops",
      "/storage-ops#index",
      "/storage-ops/profile",
      "/storage-ops/buckets",
      "/storage-ops/buckets/:bucketName",
      "/manager",
      "/manager#index",
      "/manager/profile",
      "/manager/buckets",
      "/manager/buckets/:bucketName",
      "/manager/browser",
      "/manager/metrics",
      "/manager/users",
      "/manager/users/:userName/keys",
      "/manager/users/:userName/policies",
      "/manager/groups",
      "/manager/groups/:groupName/policies",
      "/manager/groups/:groupName/users",
      "/manager/roles",
      "/manager/roles/:roleName/policies",
      "/manager/iam/policies",
      "/manager/topics",
      "/manager/ceph/keys",
      "/manager/bucket-compare",
      "/manager/bucket-integrity",
      "/manager/bucket-purge",
      "/manager/feature-rules",
      "/manager/migrations",
      "/manager/migrations/new",
      "/manager/migrations/:migrationId",
      "/browser",
      "/browser#index",
      "/browser/profile",
      "/portal",
      "/portal#index",
      "/portal/profile",
      "/portal/storage-spaces",
      "/portal/storage-spaces/:spaceId/objects/*",
      "/portal/storage-spaces/:spaceId",
      "/portal/access-keys",
      "/portal/shares",
      "/portal/shares/:userId",
      "/portal/requests",
      "/portal/history",
      "/portal/usage",
      "/portal/settings",
      "/login",
      "/oidc/:provider/callback",
      "/unauthorized",
      "/*",
    ]);
  });
});
