/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { S3AccountSelector, withS3AccountParam } from "./accountParams";
import type { BrowserRequestOptions } from "./browser";
import {
  buildBrowserWorkspaceHeaders,
  mergeBrowserHeaders,
} from "./browserRequestHeaders";
import { buildSseCustomerBackendHeaders } from "./browserSseCustomer";
import client, {
  buildApiFetchHeaders,
  LONG_RUNNING_REQUEST_TIMEOUT_MS,
} from "./client";

export type UploadProgressEvent = {
  loaded: number;
  total?: number;
  progress?: number;
};

export type PresignOperation = "get_object" | "put_object" | "delete_object";

export type PresignRequest = {
  key: string;
  operation: PresignOperation;
  expires_in?: number;
  content_type?: string | null;
  response_content_disposition?: string | null;
  version_id?: string | null;
};

export type PresignedUrl = {
  url: string;
  method: string;
  expires_in: number;
  headers?: Record<string, string>;
};

export function buildBrowserFetchHeaders(
  options?: BrowserRequestOptions,
  sseCustomerKeyBase64?: string | null,
): Record<string, string> {
  return buildApiFetchHeaders({
    ...buildBrowserWorkspaceHeaders(options),
    ...buildSseCustomerBackendHeaders(sseCustomerKeyBase64),
  });
}

export async function presignObject(
  accountId: S3AccountSelector,
  bucketName: string,
  payload: PresignRequest,
  sseCustomerKeyBase64?: string | null,
  options?: BrowserRequestOptions,
): Promise<PresignedUrl> {
  const { data } = await client.post<PresignedUrl>(
    `/browser/buckets/${encodeURIComponent(bucketName)}/presign`,
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

export async function proxyUpload(
  accountId: S3AccountSelector,
  bucketName: string,
  key: string,
  file: Blob,
  onUploadProgress?: (event: UploadProgressEvent) => void,
  signal?: AbortSignal,
  sseCustomerKeyBase64?: string | null,
  fileName?: string,
  options?: BrowserRequestOptions,
): Promise<void> {
  const form = new FormData();
  form.append("key", key);
  form.append("content_type", file.type || "application/octet-stream");
  const inferredName =
    fileName ??
    ("name" in file && typeof file.name === "string" && file.name
      ? file.name
      : "upload.bin");
  form.append("file", file, inferredName);
  onUploadProgress?.({ loaded: 0, total: file.size, progress: 0 });
  await client.post(
    `/browser/buckets/${encodeURIComponent(bucketName)}/proxy-upload`,
    form,
    {
      params: withS3AccountParam(undefined, accountId),
      headers: mergeBrowserHeaders(
        buildSseCustomerBackendHeaders(sseCustomerKeyBase64),
        buildBrowserWorkspaceHeaders(options),
      ),
      signal,
      timeout: LONG_RUNNING_REQUEST_TIMEOUT_MS,
    },
  );
  onUploadProgress?.({ loaded: file.size, total: file.size, progress: 1 });
}

export async function proxyDownload(
  accountId: S3AccountSelector,
  bucketName: string,
  key: string,
  signal?: AbortSignal,
  sseCustomerKeyBase64?: string | null,
  options?: BrowserRequestOptions,
): Promise<Blob> {
  const { data } = await client.get(
    `/browser/buckets/${encodeURIComponent(bucketName)}/download`,
    {
      params: withS3AccountParam({ key }, accountId),
      headers: mergeBrowserHeaders(
        buildSseCustomerBackendHeaders(sseCustomerKeyBase64),
        buildBrowserWorkspaceHeaders(options),
      ),
      responseType: "blob",
      signal,
      timeout: LONG_RUNNING_REQUEST_TIMEOUT_MS,
    },
  );
  return data as Blob;
}
