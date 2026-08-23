import { describe, expect, it } from "vitest";

import { resolveBucketOpsSurface } from "./bucketOpsSurface";

describe("bucketOpsSurface", () => {
  it("keeps Ceph Admin bucket workbench scoped to endpoint wording", () => {
    const surface = resolveBucketOpsSurface("ceph-admin");

    expect(surface.breadcrumb).toEqual({ label: "Ceph Admin", to: "/ceph-admin" });
    expect(surface.storageKeys.columns).toBe("ceph-admin.bucket_list.columns.v2");
    expect(surface.storageKeys.bucketListState).toBe("ceph-admin.bucket_list.state.v2");
    expect(surface.storageKeys.bulkConfigClipboard).toBe("ceph-admin.bucket_list.bulk_config_clipboard.v2");
    expect(surface.defaultVisibleColumns).toEqual(["ui_tags", "owner", "used_bytes", "object_count"]);
    expect(surface.scopeDisplayName).toBe("Endpoint");
    expect(surface.exportScopeKey).toBe("endpoint");
    expect(surface.useExplicitBucketName).toBe(false);
  });

  it("keeps Storage Ops bucket workbench scoped to cross-context wording", () => {
    const surface = resolveBucketOpsSurface("storage-ops");

    expect(surface.breadcrumb).toEqual({ label: "Storage Ops", to: "/storage-ops" });
    expect(surface.storageKeys.columns).toBe("storage-ops.bucket_list.columns.v2");
    expect(surface.storageKeys.bucketListState).toBe("storage-ops.bucket_list.state.v2");
    expect(surface.storageKeys.bulkConfigClipboard).toBe("storage-ops.bucket_list.bulk_config_clipboard.v2");
    expect(surface.defaultVisibleColumns).toEqual(["context_name", "ui_tags", "used_bytes", "object_count"]);
    expect(surface.scopeDisplayName).toBe("Scope");
    expect(surface.exportScopeKey).toBe("scope");
    expect(surface.useExplicitBucketName).toBe(true);
  });
});
