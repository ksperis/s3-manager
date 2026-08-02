import { describe, expect, it } from "vitest";
import {
  getCephAdminBucketProperties,
  listCephAdminBuckets,
  updateCephAdminBucketQuota,
} from "../../api/cephAdmin";
import {
  getStorageOpsBucketProperties,
  listStorageOpsBuckets,
  updateStorageOpsBucketQuota,
} from "../../api/storageOps";
import { resolveBucketOpsApi } from "./bucketOpsApi";

describe("bucket operations API adapter", () => {
  it("keeps the Ceph Admin and Storage Ops contracts in parity", () => {
    expect(Object.keys(resolveBucketOpsApi("ceph-admin"))).toEqual(
      Object.keys(resolveBucketOpsApi("storage-ops")),
    );
  });

  it("resolves the canonical API implementation for each surface", () => {
    expect(resolveBucketOpsApi("ceph-admin")).toMatchObject({
      listBuckets: listCephAdminBuckets,
      getBucketProperties: getCephAdminBucketProperties,
      updateBucketQuota: updateCephAdminBucketQuota,
    });
    expect(resolveBucketOpsApi("storage-ops")).toMatchObject({
      listBuckets: listStorageOpsBuckets,
      getBucketProperties: getStorageOpsBucketProperties,
      updateBucketQuota: updateStorageOpsBucketQuota,
    });
  });
});
