/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import client from "./client";
import { S3AccountSelector, withS3AccountParam } from "./accountParams";
import type {
  BrowserBucket,
  BrowserObject,
  ListBrowserObjectsResponse,
  PresignRequest,
  PresignedUrl,
  StsCredentials,
  StsStatus,
} from "./browser";

export type {
  BrowserBucket,
  BrowserObject,
  ListBrowserObjectsResponse,
  PresignRequest,
  PresignedUrl,
  StsCredentials,
  StsStatus,
};

export async function listPortalBrowserBuckets(accountId: S3AccountSelector): Promise<BrowserBucket[]> {
  const { data } = await client.get<BrowserBucket[]>("/portal/browser/buckets", { params: withS3AccountParam(undefined, accountId) });
  return data;
}

export async function listPortalBrowserObjects(
  accountId: S3AccountSelector,
  bucketName: string,
  options?: { prefix?: string; continuationToken?: string | null; maxKeys?: number }
): Promise<ListBrowserObjectsResponse> {
  const params = withS3AccountParam(
    {
      prefix: options?.prefix ?? "",
      continuation_token: options?.continuationToken ?? undefined,
      max_keys: options?.maxKeys ?? undefined,
    },
    accountId
  );
  const { data } = await client.get<ListBrowserObjectsResponse>(`/portal/browser/buckets/${encodeURIComponent(bucketName)}/objects`, { params });
  return data;
}

export async function presignPortalBrowserObject(
  accountId: S3AccountSelector,
  bucketName: string,
  payload: PresignRequest
): Promise<PresignedUrl> {
  const { data } = await client.post<PresignedUrl>(`/portal/browser/buckets/${encodeURIComponent(bucketName)}/presign`, payload, {
    params: withS3AccountParam(undefined, accountId),
  });
  return data;
}

export async function deletePortalBrowserObjects(
  accountId: S3AccountSelector,
  bucketName: string,
  keys: string[]
): Promise<void> {
  const payload = { objects: keys.filter(Boolean).map((key) => ({ key })) };
  await client.post(`/portal/browser/buckets/${encodeURIComponent(bucketName)}/delete`, payload, {
    params: withS3AccountParam(undefined, accountId),
  });
}

export async function getPortalStsStatus(accountId: S3AccountSelector): Promise<StsStatus> {
  const { data } = await client.get<StsStatus>("/portal/browser/sts", { params: withS3AccountParam(undefined, accountId) });
  return data;
}

export async function getPortalStsCredentials(accountId: S3AccountSelector): Promise<StsCredentials> {
  const { data } = await client.get<StsCredentials>("/portal/browser/sts/credentials", { params: withS3AccountParam(undefined, accountId) });
  return data;
}

export async function proxyPortalBrowserUpload(
  accountId: S3AccountSelector,
  bucketName: string,
  key: string,
  file: File
): Promise<void> {
  const formData = new FormData();
  formData.append("key", key);
  formData.append("file", file);
  await client.post(`/portal/browser/buckets/${encodeURIComponent(bucketName)}/proxy-upload`, formData, {
    params: withS3AccountParam(undefined, accountId),
    headers: { "Content-Type": "multipart/form-data" },
  });
}

export async function getPortalProxyDownloadUrl(
  accountId: S3AccountSelector,
  bucketName: string,
  key: string
): Promise<string> {
  const params = withS3AccountParam({ key }, accountId) ?? {};
  const qs = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v === undefined || v === null) return;
    qs.set(k, String(v));
  });
  const base = `/portal/browser/buckets/${encodeURIComponent(bucketName)}/proxy-download?${qs.toString()}`;
  return client.defaults.baseURL ? `${client.defaults.baseURL}${base}` : base;
}
