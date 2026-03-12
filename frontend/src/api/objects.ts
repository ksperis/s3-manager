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
