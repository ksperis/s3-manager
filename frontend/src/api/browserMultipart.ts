/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { S3AccountSelector, withS3AccountParam } from "./accountParams";
import type { BrowserRequestOptions, ObjectTag } from "./browser";
import {
  buildBrowserWorkspaceHeaders,
  mergeBrowserHeaders,
} from "./browserRequestHeaders";
import { buildSseCustomerBackendHeaders } from "./browserSseCustomer";
import client from "./client";

type MultipartUploadInitRequest = {
  key: string;
  content_type?: string | null;
  metadata?: Record<string, string>;
  tags?: ObjectTag[];
  acl?: string | null;
};

type MultipartUploadInitResponse = {
  key: string;
  upload_id: string;
};

export type MultipartUploadItem = {
  key: string;
  upload_id: string;
  initiated?: string | null;
  storage_class?: string | null;
  owner?: string | null;
};

type ListMultipartUploadsResponse = {
  uploads: MultipartUploadItem[];
  is_truncated: boolean;
  next_key?: string | null;
  next_upload_id?: string | null;
};

export type PresignPartRequest = {
  key: string;
  part_number: number;
  expires_in?: number;
};

export type PresignPartResponse = {
  url: string;
  method: string;
  expires_in: number;
  headers?: Record<string, string>;
};

type CompleteMultipartUploadRequest = {
  parts: Array<{ part_number: number; etag: string }>;
};

export async function initiateMultipartUpload(
  accountId: S3AccountSelector,
  bucketName: string,
  payload: MultipartUploadInitRequest,
  sseCustomerKeyBase64?: string | null,
  options?: BrowserRequestOptions,
): Promise<MultipartUploadInitResponse> {
  const { data } = await client.post<MultipartUploadInitResponse>(
    `/browser/buckets/${encodeURIComponent(bucketName)}/multipart/initiate`,
    payload,
    {
      params: withS3AccountParam(undefined, accountId),
      headers: mergeBrowserHeaders(
        buildSseCustomerBackendHeaders(sseCustomerKeyBase64),
        buildBrowserWorkspaceHeaders(options),
      ),
    },
  );
  return data;
}

export async function listMultipartUploads(
  accountId: S3AccountSelector,
  bucketName: string,
  options?: {
    prefix?: string;
    keyMarker?: string | null;
    uploadIdMarker?: string | null;
    maxUploads?: number;
  } & BrowserRequestOptions,
): Promise<ListMultipartUploadsResponse> {
  const params = withS3AccountParam(
    {
      prefix: options?.prefix ?? undefined,
      key_marker: options?.keyMarker ?? undefined,
      upload_id_marker: options?.uploadIdMarker ?? undefined,
      max_uploads: options?.maxUploads ?? undefined,
    },
    accountId,
  );
  const { data } = await client.get<ListMultipartUploadsResponse>(
    `/browser/buckets/${encodeURIComponent(bucketName)}/multipart`,
    { params, headers: buildBrowserWorkspaceHeaders(options) },
  );
  return data;
}

export async function presignPart(
  accountId: S3AccountSelector,
  bucketName: string,
  uploadId: string,
  payload: PresignPartRequest,
  sseCustomerKeyBase64?: string | null,
  options?: BrowserRequestOptions,
): Promise<PresignPartResponse> {
  const { data } = await client.post<PresignPartResponse>(
    `/browser/buckets/${encodeURIComponent(bucketName)}/multipart/${encodeURIComponent(uploadId)}/presign`,
    payload,
    {
      params: withS3AccountParam(undefined, accountId),
      headers: mergeBrowserHeaders(
        buildSseCustomerBackendHeaders(sseCustomerKeyBase64),
        buildBrowserWorkspaceHeaders(options),
      ),
    },
  );
  return data;
}

export async function completeMultipartUpload(
  accountId: S3AccountSelector,
  bucketName: string,
  uploadId: string,
  key: string,
  payload: CompleteMultipartUploadRequest,
  options?: BrowserRequestOptions,
): Promise<void> {
  await client.post(
    `/browser/buckets/${encodeURIComponent(bucketName)}/multipart/${encodeURIComponent(uploadId)}/complete`,
    payload,
    {
      params: withS3AccountParam({ key }, accountId),
      headers: buildBrowserWorkspaceHeaders(options),
    },
  );
}

export async function abortMultipartUpload(
  accountId: S3AccountSelector,
  bucketName: string,
  uploadId: string,
  key: string,
  options?: BrowserRequestOptions,
): Promise<void> {
  await client.delete(
    `/browser/buckets/${encodeURIComponent(bucketName)}/multipart/${encodeURIComponent(uploadId)}`,
    {
      params: withS3AccountParam({ key }, accountId),
      headers: buildBrowserWorkspaceHeaders(options),
    },
  );
}
