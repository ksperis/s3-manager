/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import client from "./client";
import { S3AccountSelector, withS3AccountParam } from "./accountParams";

export type S3Object = {
  key: string;
  size: number;
  last_modified?: string;
  storage_class?: string | null;
};

export type ListObjectsResponse = {
  prefix: string;
  objects: S3Object[];
  prefixes: string[];
  is_truncated: boolean;
  next_continuation_token?: string | null;
};

export async function uploadObject(
  accountId: S3AccountSelector,
  bucketName: string,
  file: File,
  prefix = "",
  key?: string
): Promise<{ key: string; message: string }> {
  const formData = new FormData();
  formData.append("file", file);
  if (prefix) formData.append("prefix", prefix);
  if (key) formData.append("key", key);
  const { data } = await client.post<{ key: string; message: string }>(
    `/manager/buckets/${encodeURIComponent(bucketName)}/objects/upload`,
    formData,
    {
      params: withS3AccountParam(undefined, accountId),
      headers: { "Content-Type": "multipart/form-data" },
    }
  );
  return data;
}

export async function listObjects(
  accountId: S3AccountSelector,
  bucketName: string,
  prefix = "",
  continuationToken?: string
): Promise<ListObjectsResponse> {
  const { data } = await client.get<ListObjectsResponse>(`/manager/buckets/${encodeURIComponent(bucketName)}/objects`, {
    params: withS3AccountParam(
      {
        prefix,
        continuation_token: continuationToken,
      },
      accountId
    ),
  });
  return data;
}

export async function createFolder(accountId: S3AccountSelector, bucketName: string, prefix: string): Promise<void> {
  await client.post(
    `/manager/buckets/${encodeURIComponent(bucketName)}/objects/folders`,
    { prefix },
    {
      params: withS3AccountParam(undefined, accountId),
    }
  );
}

export async function deleteObjects(accountId: S3AccountSelector, bucketName: string, keys: string[]): Promise<void> {
  await client.post(
    `/manager/buckets/${encodeURIComponent(bucketName)}/objects/delete`,
    { keys },
    { params: withS3AccountParam(undefined, accountId) }
  );
}

export async function getObjectDownloadUrl(
  accountId: S3AccountSelector,
  bucketName: string,
  key: string
): Promise<{ url: string; expires_in: number }> {
  const { data } = await client.get<{ url: string; expires_in: number }>(
    `/manager/buckets/${encodeURIComponent(bucketName)}/objects/download`,
    { params: withS3AccountParam({ key }, accountId) }
  );
  return data;
}
