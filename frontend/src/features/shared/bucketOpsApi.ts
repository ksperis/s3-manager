/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import {
  deleteCephAdminBucketCors,
  deleteCephAdminBucketLifecycle,
  deleteCephAdminBucketLogging,
  deleteCephAdminBucketNotifications,
  deleteCephAdminBucketPolicy,
  getCephAdminBucketCors,
  getCephAdminBucketEncryption,
  getCephAdminBucketLifecycle,
  getCephAdminBucketLogging,
  getCephAdminBucketNotifications,
  getCephAdminBucketPolicy,
  getCephAdminBucketProperties,
  getCephAdminBucketPublicAccessBlock,
  getCephAdminBucketWebsite,
  putCephAdminBucketCors,
  putCephAdminBucketLifecycle,
  putCephAdminBucketLogging,
  putCephAdminBucketNotifications,
  putCephAdminBucketPolicy,
  setCephAdminBucketVersioning,
  updateCephAdminBucketObjectLock,
  updateCephAdminBucketPublicAccessBlock,
  updateCephAdminBucketQuota,
} from "../../api/cephAdminBucketDetails";
import {
  listCephAdminBuckets,
  refreshCephAdminBucketListingCache,
  streamCephAdminBuckets,
} from "../../api/cephAdminBuckets";
import {
  deleteStorageOpsBucketCors,
  deleteStorageOpsBucketLifecycle,
  deleteStorageOpsBucketLogging,
  deleteStorageOpsBucketNotifications,
  deleteStorageOpsBucketPolicy,
  getStorageOpsBucketCors,
  getStorageOpsBucketEncryption,
  getStorageOpsBucketLifecycle,
  getStorageOpsBucketLogging,
  getStorageOpsBucketNotifications,
  getStorageOpsBucketPolicy,
  getStorageOpsBucketProperties,
  getStorageOpsBucketPublicAccessBlock,
  getStorageOpsBucketWebsite,
  listStorageOpsBuckets,
  putStorageOpsBucketCors,
  putStorageOpsBucketLifecycle,
  putStorageOpsBucketLogging,
  putStorageOpsBucketNotifications,
  putStorageOpsBucketPolicy,
  refreshStorageOpsBucketListingCache,
  setStorageOpsBucketVersioning,
  streamStorageOpsBuckets,
  updateStorageOpsBucketObjectLock,
  updateStorageOpsBucketPublicAccessBlock,
} from "../../api/storageOps";
import type { BucketOpsMode } from "./bucketOpsSurface";

const CEPH_ADMIN_BUCKET_OPS_API = {
  listBuckets: listCephAdminBuckets,
  streamBuckets: streamCephAdminBuckets,
  refreshBucketListingCache: refreshCephAdminBucketListingCache,
  getBucketProperties: getCephAdminBucketProperties,
  getBucketPublicAccessBlock: getCephAdminBucketPublicAccessBlock,
  updateBucketPublicAccessBlock: updateCephAdminBucketPublicAccessBlock,
  getBucketLifecycle: getCephAdminBucketLifecycle,
  putBucketLifecycle: putCephAdminBucketLifecycle,
  deleteBucketLifecycle: deleteCephAdminBucketLifecycle,
  getBucketCors: getCephAdminBucketCors,
  putBucketCors: putCephAdminBucketCors,
  deleteBucketCors: deleteCephAdminBucketCors,
  getBucketPolicy: getCephAdminBucketPolicy,
  putBucketPolicy: putCephAdminBucketPolicy,
  deleteBucketPolicy: deleteCephAdminBucketPolicy,
  getBucketLogging: getCephAdminBucketLogging,
  putBucketLogging: putCephAdminBucketLogging,
  deleteBucketLogging: deleteCephAdminBucketLogging,
  getBucketNotifications: getCephAdminBucketNotifications,
  putBucketNotifications: putCephAdminBucketNotifications,
  deleteBucketNotifications: deleteCephAdminBucketNotifications,
  getBucketWebsite: getCephAdminBucketWebsite,
  getBucketEncryption: getCephAdminBucketEncryption,
  setBucketVersioning: setCephAdminBucketVersioning,
  updateBucketObjectLock: updateCephAdminBucketObjectLock,
  updateBucketQuota: updateCephAdminBucketQuota,
} as const;

export type BucketOpsApi = Omit<typeof CEPH_ADMIN_BUCKET_OPS_API, "updateBucketQuota"> & {
  updateBucketQuota?: typeof updateCephAdminBucketQuota;
};

const STORAGE_OPS_BUCKET_OPS_API: BucketOpsApi = {
  listBuckets: listStorageOpsBuckets,
  streamBuckets: streamStorageOpsBuckets,
  refreshBucketListingCache: refreshStorageOpsBucketListingCache,
  getBucketProperties: getStorageOpsBucketProperties,
  getBucketPublicAccessBlock: getStorageOpsBucketPublicAccessBlock,
  updateBucketPublicAccessBlock: updateStorageOpsBucketPublicAccessBlock,
  getBucketLifecycle: getStorageOpsBucketLifecycle,
  putBucketLifecycle: putStorageOpsBucketLifecycle,
  deleteBucketLifecycle: deleteStorageOpsBucketLifecycle,
  getBucketCors: getStorageOpsBucketCors,
  putBucketCors: putStorageOpsBucketCors,
  deleteBucketCors: deleteStorageOpsBucketCors,
  getBucketPolicy: getStorageOpsBucketPolicy,
  putBucketPolicy: putStorageOpsBucketPolicy,
  deleteBucketPolicy: deleteStorageOpsBucketPolicy,
  getBucketLogging: getStorageOpsBucketLogging,
  putBucketLogging: putStorageOpsBucketLogging,
  deleteBucketLogging: deleteStorageOpsBucketLogging,
  getBucketNotifications: getStorageOpsBucketNotifications,
  putBucketNotifications: putStorageOpsBucketNotifications,
  deleteBucketNotifications: deleteStorageOpsBucketNotifications,
  getBucketWebsite: getStorageOpsBucketWebsite,
  getBucketEncryption: getStorageOpsBucketEncryption,
  setBucketVersioning: setStorageOpsBucketVersioning,
  updateBucketObjectLock: updateStorageOpsBucketObjectLock,
};

export function resolveBucketOpsApi(mode: BucketOpsMode): BucketOpsApi {
  return mode === "storage-ops"
    ? STORAGE_OPS_BUCKET_OPS_API
    : CEPH_ADMIN_BUCKET_OPS_API;
}
