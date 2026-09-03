import { describe, expect, it } from "vitest";
import type { CephAdminBucket } from "../../api/cephAdminBuckets";
import {
  buildBucketOpsListOrigin,
  buildBucketOpsNavigationTarget,
} from "./bucketOpsTableNavigation";

const cephBucket: CephAdminBucket = { name: "logs/archive" };
const storageBucket: CephAdminBucket = {
  name: "account-1::archive",
  bucket_name: "logs/archive",
  context_id: "account 1",
};

describe("bucketOpsTableNavigation", () => {
  it("builds Ceph Admin configuration and browser destinations", () => {
    expect(
      buildBucketOpsNavigationTarget({
        action: "configure",
        bucket: cephBucket,
        mode: "ceph-admin",
        selectedEndpointId: 7,
      }),
    ).toEqual({
      pathname: "/ceph-admin/buckets/logs%2Farchive",
      search: "?ep=7",
    });
    expect(
      buildBucketOpsNavigationTarget({
        action: "browser",
        bucket: cephBucket,
        mode: "ceph-admin",
        selectedEndpointId: 7,
      }),
    ).toEqual({
      pathname: "/ceph-admin/browser",
      search: "?ep=7&bucket=logs%2Farchive",
    });
  });

  it("builds Storage Ops configuration and Manager destinations", () => {
    expect(
      buildBucketOpsNavigationTarget({
        action: "configure",
        bucket: storageBucket,
        mode: "storage-ops",
        selectedEndpointId: 1,
      }),
    ).toEqual({
      pathname: "/storage-ops/buckets/logs%2Farchive",
      search: "?ctx=account+1",
    });
    expect(
      buildBucketOpsNavigationTarget({
        action: "manager",
        bucket: storageBucket,
        mode: "storage-ops",
        selectedEndpointId: 1,
      }),
    ).toEqual({
      pathname: "/manager/buckets/logs%2Farchive",
      search: "?ctx=account+1",
    });
  });

  it("rejects incompatible surfaces and incomplete identities", () => {
    expect(
      buildBucketOpsNavigationTarget({
        action: "manager",
        bucket: cephBucket,
        mode: "ceph-admin",
        selectedEndpointId: 7,
      }),
    ).toBeNull();
    expect(
      buildBucketOpsNavigationTarget({
        action: "browser",
        bucket: storageBucket,
        mode: "storage-ops",
        selectedEndpointId: 1,
      }),
    ).toBeNull();
    expect(
      buildBucketOpsNavigationTarget({
        action: "configure",
        bucket: { name: "missing-context" },
        mode: "storage-ops",
        selectedEndpointId: 1,
      }),
    ).toBeNull();
    expect(
      buildBucketOpsNavigationTarget({
        action: "configure",
        bucket: cephBucket,
        mode: "ceph-admin",
        selectedEndpointId: null,
      }),
    ).toBeNull();
  });

  it("builds canonical list origins only for an active scope", () => {
    expect(
      buildBucketOpsListOrigin({
        listUrl: "/storage-ops/buckets?owner=alice",
        mode: "storage-ops",
        selectedEndpointId: 1,
      }),
    ).toEqual({
      surface: "storage-ops",
      scopeKey: "storage-ops",
      listUrl: "/storage-ops/buckets?owner=alice",
    });
    expect(
      buildBucketOpsListOrigin({
        listUrl: "/ceph-admin/buckets",
        mode: "ceph-admin",
        selectedEndpointId: 7,
      }),
    ).toEqual({
      surface: "ceph-admin",
      scopeKey: "7",
      listUrl: "/ceph-admin/buckets",
    });
    expect(
      buildBucketOpsListOrigin({
        listUrl: "/ceph-admin/buckets",
        mode: "ceph-admin",
        selectedEndpointId: null,
      }),
    ).toBeNull();
  });
});
