/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import type { ListBrowserObjectsResponse } from "./browser";
import type {
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
  BucketTag,
  BucketWebsiteConfiguration,
} from "./buckets";
import client from "./client";

type BucketReplicationConfiguration = {
  configuration: Record<string, unknown>;
};

type BucketVersioningStatus = {
  status?: string | null;
  enabled: boolean;
};

function cephAdminBucketPath(endpointId: number, bucketName: string): string {
  return `/ceph-admin/endpoints/${endpointId}/buckets/${encodeURIComponent(bucketName)}`;
}

export async function listCephAdminBucketObjects(
  endpointId: number,
  bucketName: string,
  prefix = "",
): Promise<ListBrowserObjectsResponse> {
  const { data } = await client.get<ListBrowserObjectsResponse>(
    `${cephAdminBucketPath(endpointId, bucketName)}/objects`,
    { params: { prefix } },
  );
  return data;
}

export async function getCephAdminBucketProperties(
  endpointId: number,
  bucketName: string,
): Promise<BucketProperties> {
  const { data } = await client.get<BucketProperties>(
    `${cephAdminBucketPath(endpointId, bucketName)}/properties`,
  );
  return data;
}

export async function getCephAdminBucketVersioning(
  endpointId: number,
  bucketName: string,
): Promise<BucketVersioningStatus> {
  const { data } = await client.get<BucketVersioningStatus>(
    `${cephAdminBucketPath(endpointId, bucketName)}/versioning`,
  );
  return data;
}

export async function setCephAdminBucketVersioning(
  endpointId: number,
  bucketName: string,
  enabled: boolean,
): Promise<void> {
  await client.put(`${cephAdminBucketPath(endpointId, bucketName)}/versioning`, {
    enabled,
  });
}

export async function getCephAdminBucketLifecycle(
  endpointId: number,
  bucketName: string,
): Promise<BucketLifecycleConfig> {
  const { data } = await client.get<BucketLifecycleConfig>(
    `${cephAdminBucketPath(endpointId, bucketName)}/lifecycle`,
  );
  return data;
}

export async function putCephAdminBucketLifecycle(
  endpointId: number,
  bucketName: string,
  rules: Record<string, unknown>[],
): Promise<BucketLifecycleConfig> {
  const { data } = await client.put<BucketLifecycleConfig>(
    `${cephAdminBucketPath(endpointId, bucketName)}/lifecycle`,
    { rules },
  );
  return data;
}

export async function deleteCephAdminBucketLifecycle(
  endpointId: number,
  bucketName: string,
): Promise<void> {
  await client.delete(`${cephAdminBucketPath(endpointId, bucketName)}/lifecycle`);
}

export async function getCephAdminBucketCors(
  endpointId: number,
  bucketName: string,
): Promise<BucketCors> {
  const { data } = await client.get<BucketCors>(
    `${cephAdminBucketPath(endpointId, bucketName)}/cors`,
  );
  return data;
}

export async function putCephAdminBucketCors(
  endpointId: number,
  bucketName: string,
  rules: Record<string, unknown>[],
): Promise<BucketCors> {
  const { data } = await client.put<BucketCors>(
    `${cephAdminBucketPath(endpointId, bucketName)}/cors`,
    { rules },
  );
  return data;
}

export async function deleteCephAdminBucketCors(
  endpointId: number,
  bucketName: string,
): Promise<void> {
  await client.delete(`${cephAdminBucketPath(endpointId, bucketName)}/cors`);
}

export async function getCephAdminBucketEncryption(
  endpointId: number,
  bucketName: string,
): Promise<BucketEncryptionConfiguration> {
  const { data } = await client.get<BucketEncryptionConfiguration>(
    `${cephAdminBucketPath(endpointId, bucketName)}/encryption`,
  );
  return data;
}

export async function putCephAdminBucketEncryption(
  endpointId: number,
  bucketName: string,
  rules: Record<string, unknown>[],
): Promise<BucketEncryptionConfiguration> {
  const { data } = await client.put<BucketEncryptionConfiguration>(
    `${cephAdminBucketPath(endpointId, bucketName)}/encryption`,
    { rules },
  );
  return data;
}

export async function deleteCephAdminBucketEncryption(
  endpointId: number,
  bucketName: string,
): Promise<void> {
  await client.delete(`${cephAdminBucketPath(endpointId, bucketName)}/encryption`);
}

export async function getCephAdminBucketPolicy(
  endpointId: number,
  bucketName: string,
): Promise<BucketPolicy> {
  const { data } = await client.get<BucketPolicy>(
    `${cephAdminBucketPath(endpointId, bucketName)}/policy`,
  );
  return data;
}

export async function putCephAdminBucketPolicy(
  endpointId: number,
  bucketName: string,
  policy: Record<string, unknown>,
): Promise<BucketPolicy> {
  const { data } = await client.put<BucketPolicy>(
    `${cephAdminBucketPath(endpointId, bucketName)}/policy`,
    { policy },
  );
  return data;
}

export async function deleteCephAdminBucketPolicy(
  endpointId: number,
  bucketName: string,
): Promise<void> {
  await client.delete(`${cephAdminBucketPath(endpointId, bucketName)}/policy`);
}

export async function getCephAdminBucketNotifications(
  endpointId: number,
  bucketName: string,
): Promise<BucketNotificationConfiguration> {
  const { data } = await client.get<BucketNotificationConfiguration>(
    `${cephAdminBucketPath(endpointId, bucketName)}/notifications`,
  );
  return data;
}

export async function putCephAdminBucketNotifications(
  endpointId: number,
  bucketName: string,
  configuration: Record<string, unknown>,
): Promise<BucketNotificationConfiguration> {
  const { data } = await client.put<BucketNotificationConfiguration>(
    `${cephAdminBucketPath(endpointId, bucketName)}/notifications`,
    { configuration },
  );
  return data;
}

export async function deleteCephAdminBucketNotifications(
  endpointId: number,
  bucketName: string,
): Promise<void> {
  await client.delete(
    `${cephAdminBucketPath(endpointId, bucketName)}/notifications`,
  );
}

export async function getCephAdminBucketReplication(
  endpointId: number,
  bucketName: string,
): Promise<BucketReplicationConfiguration> {
  const { data } = await client.get<BucketReplicationConfiguration>(
    `${cephAdminBucketPath(endpointId, bucketName)}/replication`,
  );
  return data;
}

export async function putCephAdminBucketReplication(
  endpointId: number,
  bucketName: string,
  configuration: Record<string, unknown>,
): Promise<BucketReplicationConfiguration> {
  const { data } = await client.put<BucketReplicationConfiguration>(
    `${cephAdminBucketPath(endpointId, bucketName)}/replication`,
    { configuration },
  );
  return data;
}

export async function deleteCephAdminBucketReplication(
  endpointId: number,
  bucketName: string,
): Promise<void> {
  await client.delete(`${cephAdminBucketPath(endpointId, bucketName)}/replication`);
}

export async function getCephAdminBucketLogging(
  endpointId: number,
  bucketName: string,
): Promise<BucketLoggingConfiguration> {
  const { data } = await client.get<BucketLoggingConfiguration>(
    `${cephAdminBucketPath(endpointId, bucketName)}/logging`,
  );
  return data;
}

export async function putCephAdminBucketLogging(
  endpointId: number,
  bucketName: string,
  payload: BucketLoggingConfiguration,
): Promise<BucketLoggingConfiguration> {
  const { data } = await client.put<BucketLoggingConfiguration>(
    `${cephAdminBucketPath(endpointId, bucketName)}/logging`,
    payload,
  );
  return data;
}

export async function deleteCephAdminBucketLogging(
  endpointId: number,
  bucketName: string,
): Promise<void> {
  await client.delete(`${cephAdminBucketPath(endpointId, bucketName)}/logging`);
}

export async function getCephAdminBucketWebsite(
  endpointId: number,
  bucketName: string,
): Promise<BucketWebsiteConfiguration> {
  const { data } = await client.get<BucketWebsiteConfiguration>(
    `${cephAdminBucketPath(endpointId, bucketName)}/website`,
  );
  return data;
}

export async function putCephAdminBucketWebsite(
  endpointId: number,
  bucketName: string,
  payload: BucketWebsiteConfiguration,
): Promise<BucketWebsiteConfiguration> {
  const { data } = await client.put<BucketWebsiteConfiguration>(
    `${cephAdminBucketPath(endpointId, bucketName)}/website`,
    payload,
  );
  return data;
}

export async function deleteCephAdminBucketWebsite(
  endpointId: number,
  bucketName: string,
): Promise<void> {
  await client.delete(`${cephAdminBucketPath(endpointId, bucketName)}/website`);
}

export async function getCephAdminBucketTags(
  endpointId: number,
  bucketName: string,
): Promise<{ tags: BucketTag[] }> {
  const { data } = await client.get<{ tags: BucketTag[] }>(
    `${cephAdminBucketPath(endpointId, bucketName)}/tags`,
  );
  return data;
}

export async function putCephAdminBucketTags(
  endpointId: number,
  bucketName: string,
  tags: BucketTag[],
): Promise<void> {
  await client.put(`${cephAdminBucketPath(endpointId, bucketName)}/tags`, { tags });
}

export async function deleteCephAdminBucketTags(
  endpointId: number,
  bucketName: string,
): Promise<void> {
  await client.delete(`${cephAdminBucketPath(endpointId, bucketName)}/tags`);
}

export async function getCephAdminBucketAcl(
  endpointId: number,
  bucketName: string,
): Promise<BucketAcl> {
  const { data } = await client.get<BucketAcl>(
    `${cephAdminBucketPath(endpointId, bucketName)}/acl`,
  );
  return data;
}

export async function updateCephAdminBucketAcl(
  endpointId: number,
  bucketName: string,
  acl: string,
): Promise<BucketAcl> {
  const { data } = await client.put<BucketAcl>(
    `${cephAdminBucketPath(endpointId, bucketName)}/acl`,
    { acl },
  );
  return data;
}

export async function getCephAdminBucketPublicAccessBlock(
  endpointId: number,
  bucketName: string,
): Promise<BucketPublicAccessBlock> {
  const { data } = await client.get<BucketPublicAccessBlock>(
    `${cephAdminBucketPath(endpointId, bucketName)}/public-access-block`,
  );
  return data;
}

export async function updateCephAdminBucketPublicAccessBlock(
  endpointId: number,
  bucketName: string,
  payload: BucketPublicAccessBlock,
): Promise<BucketPublicAccessBlock> {
  const { data } = await client.put<BucketPublicAccessBlock>(
    `${cephAdminBucketPath(endpointId, bucketName)}/public-access-block`,
    payload,
  );
  return data;
}

export async function getCephAdminBucketObjectLock(
  endpointId: number,
  bucketName: string,
): Promise<BucketObjectLockConfiguration> {
  const { data } = await client.get<BucketObjectLockConfiguration>(
    `${cephAdminBucketPath(endpointId, bucketName)}/object-lock`,
  );
  return data;
}

export async function updateCephAdminBucketObjectLock(
  endpointId: number,
  bucketName: string,
  payload: BucketObjectLockConfiguration,
): Promise<BucketObjectLockConfiguration> {
  const { data } = await client.put<BucketObjectLockConfiguration>(
    `${cephAdminBucketPath(endpointId, bucketName)}/object-lock`,
    payload,
  );
  return data;
}

export async function updateCephAdminBucketQuota(
  endpointId: number,
  bucketName: string,
  payload: BucketQuotaUpdate,
): Promise<void> {
  await client.put(
    `${cephAdminBucketPath(endpointId, bucketName)}/quota`,
    payload,
  );
}
