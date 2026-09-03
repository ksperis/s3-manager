/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import type { S3AccountSelector } from "./accountParams";
import { withS3AccountParam } from "./accountParams";
import type {
  Bucket,
  BucketAcl,
  BucketCors,
  BucketEncryptionConfiguration,
  BucketLifecycleConfig,
  BucketLoggingConfiguration,
  BucketNotificationConfiguration,
  BucketObjectLockConfiguration,
  BucketPolicy,
  BucketProperties,
  BucketPublicAccessBlock,
  BucketQuotaUpdate,
  BucketReplicationConfiguration,
  BucketTag,
  BucketVersioningStatus,
  BucketWebsiteConfiguration,
} from "./bucketContracts";
import client from "./client";

const MANAGER_BUCKETS_PATH = "/manager/buckets";
const BROWSER_BUCKET_CONFIG_PATH = "/browser/buckets/config";

function createManagerBucketDetailsApi() {
  const basePath = MANAGER_BUCKETS_PATH;
  const bucketPath = (bucketName: string) =>
    `${basePath}/${encodeURIComponent(bucketName)}`;
  const requestConfig = (accountId: S3AccountSelector) => ({
    params: withS3AccountParam(undefined, accountId),
  });
  const read = async <T>(
    accountId: S3AccountSelector,
    bucketName: string,
    resource: string,
  ): Promise<T> => {
    const { data } = await client.get<T>(
      `${bucketPath(bucketName)}/${resource}`,
      requestConfig(accountId),
    );
    return data;
  };
  const write = async <T>(
    accountId: S3AccountSelector,
    bucketName: string,
    resource: string,
    payload: unknown,
  ): Promise<T> => {
    const { data } = await client.put<T>(
      `${bucketPath(bucketName)}/${resource}`,
      payload,
      requestConfig(accountId),
    );
    return data;
  };
  const writeWithoutResponse = async (
    accountId: S3AccountSelector,
    bucketName: string,
    resource: string,
    payload: unknown,
  ): Promise<void> => {
    await client.put(
      `${bucketPath(bucketName)}/${resource}`,
      payload,
      requestConfig(accountId),
    );
  };
  const remove = async (
    accountId: S3AccountSelector,
    bucketName: string,
    resource: string,
  ): Promise<void> => {
    await client.delete(
      `${bucketPath(bucketName)}/${resource}`,
      requestConfig(accountId),
    );
  };

  return {
    async getBucketStats(
      accountId: S3AccountSelector,
      bucketName: string,
      options?: { with_stats?: boolean },
    ): Promise<Bucket> {
      const { data } = await client.get<Bucket>(
        `${bucketPath(bucketName)}/stats`,
        {
          params: withS3AccountParam(
            { with_stats: options?.with_stats },
            accountId,
          ),
        },
      );
      return data;
    },
    getBucketProperties: (accountId: S3AccountSelector, bucketName: string) =>
      read<BucketProperties>(accountId, bucketName, "properties"),
    getBucketAcl: (accountId: S3AccountSelector, bucketName: string) =>
      read<BucketAcl>(accountId, bucketName, "acl"),
    updateBucketAcl: (
      accountId: S3AccountSelector,
      bucketName: string,
      acl: string,
    ) => write<BucketAcl>(accountId, bucketName, "acl", { acl }),
    getBucketPublicAccessBlock: (
      accountId: S3AccountSelector,
      bucketName: string,
    ) =>
      read<BucketPublicAccessBlock>(
        accountId,
        bucketName,
        "public-access-block",
      ),
    updateBucketPublicAccessBlock: (
      accountId: S3AccountSelector,
      bucketName: string,
      payload: BucketPublicAccessBlock,
    ) =>
      write<BucketPublicAccessBlock>(
        accountId,
        bucketName,
        "public-access-block",
        payload,
      ),
    updateBucketQuota: (
      accountId: S3AccountSelector,
      bucketName: string,
      payload: BucketQuotaUpdate,
    ) => writeWithoutResponse(accountId, bucketName, "quota", payload),
    getBucketVersioning: (
      accountId: S3AccountSelector,
      bucketName: string,
    ) => read<BucketVersioningStatus>(accountId, bucketName, "versioning"),
    setBucketVersioning: (
      accountId: S3AccountSelector,
      bucketName: string,
      enabled: boolean,
    ) =>
      writeWithoutResponse(accountId, bucketName, "versioning", { enabled }),
    getBucketPolicy: (accountId: S3AccountSelector, bucketName: string) =>
      read<BucketPolicy>(accountId, bucketName, "policy"),
    putBucketPolicy: (
      accountId: S3AccountSelector,
      bucketName: string,
      policy: Record<string, unknown>,
    ) => write<BucketPolicy>(accountId, bucketName, "policy", { policy }),
    deleteBucketPolicy: (accountId: S3AccountSelector, bucketName: string) =>
      remove(accountId, bucketName, "policy"),
    getBucketLifecycle: (accountId: S3AccountSelector, bucketName: string) =>
      read<BucketLifecycleConfig>(accountId, bucketName, "lifecycle"),
    putBucketLifecycle: (
      accountId: S3AccountSelector,
      bucketName: string,
      rules: Record<string, unknown>[],
    ) =>
      write<BucketLifecycleConfig>(accountId, bucketName, "lifecycle", {
        rules,
      }),
    deleteBucketLifecycle: (
      accountId: S3AccountSelector,
      bucketName: string,
    ) => remove(accountId, bucketName, "lifecycle"),
    getBucketCors: (accountId: S3AccountSelector, bucketName: string) =>
      read<BucketCors>(accountId, bucketName, "cors"),
    putBucketCors: (
      accountId: S3AccountSelector,
      bucketName: string,
      rules: Record<string, unknown>[],
    ) => write<BucketCors>(accountId, bucketName, "cors", { rules }),
    deleteBucketCors: (accountId: S3AccountSelector, bucketName: string) =>
      remove(accountId, bucketName, "cors"),
    getBucketEncryption: (accountId: S3AccountSelector, bucketName: string) =>
      read<BucketEncryptionConfiguration>(accountId, bucketName, "encryption"),
    putBucketEncryption: (
      accountId: S3AccountSelector,
      bucketName: string,
      rules: Record<string, unknown>[],
    ) =>
      write<BucketEncryptionConfiguration>(
        accountId,
        bucketName,
        "encryption",
        { rules },
      ),
    deleteBucketEncryption: (
      accountId: S3AccountSelector,
      bucketName: string,
    ) => remove(accountId, bucketName, "encryption"),
    getBucketTags: (accountId: S3AccountSelector, bucketName: string) =>
      read<{ tags: BucketTag[] }>(accountId, bucketName, "tags"),
    putBucketTags: (
      accountId: S3AccountSelector,
      bucketName: string,
      tags: BucketTag[],
    ) => writeWithoutResponse(accountId, bucketName, "tags", { tags }),
    deleteBucketTags: (accountId: S3AccountSelector, bucketName: string) =>
      remove(accountId, bucketName, "tags"),
    getBucketLogging: (accountId: S3AccountSelector, bucketName: string) =>
      read<BucketLoggingConfiguration>(accountId, bucketName, "logging"),
    putBucketLogging: (
      accountId: S3AccountSelector,
      bucketName: string,
      payload: BucketLoggingConfiguration,
    ) =>
      write<BucketLoggingConfiguration>(
        accountId,
        bucketName,
        "logging",
        payload,
      ),
    deleteBucketLogging: (accountId: S3AccountSelector, bucketName: string) =>
      remove(accountId, bucketName, "logging"),
    getBucketNotifications: (
      accountId: S3AccountSelector,
      bucketName: string,
    ) =>
      read<BucketNotificationConfiguration>(
        accountId,
        bucketName,
        "notifications",
      ),
    putBucketNotifications: (
      accountId: S3AccountSelector,
      bucketName: string,
      configuration: Record<string, unknown>,
    ) =>
      write<BucketNotificationConfiguration>(
        accountId,
        bucketName,
        "notifications",
        { configuration },
      ),
    deleteBucketNotifications: (
      accountId: S3AccountSelector,
      bucketName: string,
    ) => remove(accountId, bucketName, "notifications"),
    getBucketReplication: (
      accountId: S3AccountSelector,
      bucketName: string,
    ) =>
      read<BucketReplicationConfiguration>(accountId, bucketName, "replication"),
    putBucketReplication: (
      accountId: S3AccountSelector,
      bucketName: string,
      configuration: Record<string, unknown>,
    ) =>
      write<BucketReplicationConfiguration>(
        accountId,
        bucketName,
        "replication",
        { configuration },
      ),
    deleteBucketReplication: (
      accountId: S3AccountSelector,
      bucketName: string,
    ) => remove(accountId, bucketName, "replication"),
    getBucketWebsite: (accountId: S3AccountSelector, bucketName: string) =>
      read<BucketWebsiteConfiguration>(accountId, bucketName, "website"),
    putBucketWebsite: (
      accountId: S3AccountSelector,
      bucketName: string,
      payload: BucketWebsiteConfiguration,
    ) =>
      write<BucketWebsiteConfiguration>(
        accountId,
        bucketName,
        "website",
        payload,
      ),
    deleteBucketWebsite: (accountId: S3AccountSelector, bucketName: string) =>
      remove(accountId, bucketName, "website"),
    getBucketObjectLock: (accountId: S3AccountSelector, bucketName: string) =>
      read<BucketObjectLockConfiguration>(accountId, bucketName, "object-lock"),
    updateBucketObjectLock: (
      accountId: S3AccountSelector,
      bucketName: string,
      payload: BucketObjectLockConfiguration,
    ) =>
      write<BucketObjectLockConfiguration>(
        accountId,
        bucketName,
        "object-lock",
        payload,
      ),
  };
}

function createBrowserBucketDetailsApi() {
  const bucketPath = (bucketName: string) =>
    `${BROWSER_BUCKET_CONFIG_PATH}/${encodeURIComponent(bucketName)}`;
  const requestConfig = (accountId: S3AccountSelector) => ({
    params: withS3AccountParam(undefined, accountId),
  });
  const read = async <T>(
    accountId: S3AccountSelector,
    bucketName: string,
    resource: string,
  ): Promise<T> => {
    const { data } = await client.get<T>(
      `${bucketPath(bucketName)}/${resource}`,
      requestConfig(accountId),
    );
    return data;
  };

  return {
    async getBucketStats(
      accountId: S3AccountSelector,
      bucketName: string,
      options?: { with_stats?: boolean },
    ): Promise<Bucket> {
      const { data } = await client.get<Bucket>(
        `${bucketPath(bucketName)}/stats`,
        {
          params: withS3AccountParam(
            { with_stats: options?.with_stats },
            accountId,
          ),
        },
      );
      return data;
    },
    getBucketProperties: (accountId: S3AccountSelector, bucketName: string) =>
      read<BucketProperties>(accountId, bucketName, "properties"),
    getBucketPolicy: (accountId: S3AccountSelector, bucketName: string) =>
      read<BucketPolicy>(accountId, bucketName, "policy"),
    getBucketLogging: (accountId: S3AccountSelector, bucketName: string) =>
      read<BucketLoggingConfiguration>(accountId, bucketName, "logging"),
    getBucketWebsite: (accountId: S3AccountSelector, bucketName: string) =>
      read<BucketWebsiteConfiguration>(accountId, bucketName, "website"),
  };
}

const managerBucketDetails = createManagerBucketDetailsApi();

export const {
  deleteBucketCors,
  deleteBucketEncryption,
  deleteBucketLifecycle,
  deleteBucketLogging,
  deleteBucketNotifications,
  deleteBucketPolicy,
  deleteBucketReplication,
  deleteBucketTags,
  deleteBucketWebsite,
  getBucketAcl,
  getBucketCors,
  getBucketEncryption,
  getBucketLifecycle,
  getBucketLogging,
  getBucketNotifications,
  getBucketObjectLock,
  getBucketPolicy,
  getBucketProperties,
  getBucketPublicAccessBlock,
  getBucketReplication,
  getBucketStats,
  getBucketTags,
  getBucketVersioning,
  getBucketWebsite,
  putBucketCors,
  putBucketEncryption,
  putBucketLifecycle,
  putBucketLogging,
  putBucketNotifications,
  putBucketPolicy,
  putBucketReplication,
  putBucketTags,
  putBucketWebsite,
  setBucketVersioning,
  updateBucketAcl,
  updateBucketObjectLock,
  updateBucketPublicAccessBlock,
  updateBucketQuota,
} = managerBucketDetails;

export const browserBucketDetails = createBrowserBucketDetailsApi();
