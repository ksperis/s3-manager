import { describe, expect, it } from "vitest";
import {
  getCephAdminBucketProperties,
  listCephAdminBuckets,
  updateCephAdminBucketQuota,
} from "../../api/cephAdminBuckets";
import {
  getStorageOpsBucketProperties,
  listStorageOpsBuckets,
} from "../../api/storageOps";
import { resolveBucketOpsApi } from "./bucketOpsApi";

describe("bucket operations API adapter", () => {
  it("resolves the canonical API implementation for each surface", () => {
    expect(resolveBucketOpsApi("ceph-admin")).toMatchObject({
      listBuckets: listCephAdminBuckets,
      getBucketProperties: getCephAdminBucketProperties,
      updateBucketQuota: updateCephAdminBucketQuota,
    });
    expect(resolveBucketOpsApi("storage-ops")).toMatchObject({
      listBuckets: listStorageOpsBuckets,
      getBucketProperties: getStorageOpsBucketProperties,
    });
    expect(resolveBucketOpsApi("storage-ops")).not.toHaveProperty("updateBucketQuota");
  });
});
