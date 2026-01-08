/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import client from "./client";
import { S3AccountSelector, withS3AccountParam } from "./accountParams";

export type PortalBucketCreateRequest = {
  name: string;
  versioning?: boolean;
};

export type PortalBucketCreateResponse = {
  name: string;
  versioning: boolean;
  tags: Record<string, string>;
};

export async function createPortalBucket(
  accountId: S3AccountSelector,
  payload: PortalBucketCreateRequest
): Promise<PortalBucketCreateResponse> {
  const { data } = await client.post<PortalBucketCreateResponse>("/portal/buckets", payload, {
    params: withS3AccountParam(undefined, accountId),
  });
  return data;
}

