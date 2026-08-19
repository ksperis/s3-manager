/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import {
  withS3AccountParam,
  type S3AccountSelector,
} from "../../api/accountParams";
import {
  buildBrowserFetchHeaders,
  presignObject,
  proxyDownload,
  proxyUpload,
  type BrowserRequestOptions,
  type PresignedUrl,
  type PresignRequest,
} from "../../api/browser";
import { buildApiUrl } from "../../api/client";
import {
  ensureSuccessfulBrowserTransferResponse,
  readBrowserTransferBlob,
  readBrowserTransferStream,
} from "./browserFetchTransferResponse";

type BrowserTransferMode = "direct" | "proxy";

type BrowserTransferObjectRef = {
  selector: S3AccountSelector;
  bucket: string;
  key: string;
  sseCustomerKeyBase64?: string | null;
  signal?: AbortSignal;
};

type BrowserTransferDownloadParams = BrowserTransferObjectRef & {
  mode: BrowserTransferMode;
  options?: BrowserRequestOptions;
  directPresign?: (payload: PresignRequest) => Promise<PresignedUrl>;
};

type BrowserTransferUploadParams = BrowserTransferObjectRef & {
  mode: BrowserTransferMode;
  blob: Blob;
  contentType?: string | null;
  options?: BrowserRequestOptions;
};

const presignDownload = async (
  {
    selector,
    bucket,
    key,
    sseCustomerKeyBase64,
    options,
    directPresign,
  }: BrowserTransferDownloadParams,
): Promise<PresignedUrl> => {
  const payload: PresignRequest = {
    key,
    operation: "get_object",
    expires_in: 900,
  };
  if (directPresign) {
    return directPresign(payload);
  }
  return presignObject(
    selector,
    bucket,
    payload,
    sseCustomerKeyBase64,
    options,
  );
};

export const downloadBrowserTransferBlob = async (
  params: BrowserTransferDownloadParams,
): Promise<Blob> => {
  const {
    selector,
    bucket,
    key,
    mode,
    signal,
    sseCustomerKeyBase64,
    options,
  } = params;
  if (mode === "proxy") {
    return proxyDownload(
      selector,
      bucket,
      key,
      signal,
      sseCustomerKeyBase64,
      options,
    );
  }
  const signedDownload = await presignDownload(params);
  const response = await fetch(signedDownload.url, {
    headers: signedDownload.headers || undefined,
    signal,
  });
  return readBrowserTransferBlob(response, `Download failed for ${key}`);
};

export const downloadBrowserTransferStream = async (
  params: BrowserTransferDownloadParams,
): Promise<ReadableStream<Uint8Array>> => {
  const {
    selector,
    bucket,
    key,
    mode,
    signal,
    sseCustomerKeyBase64,
    options,
  } = params;
  if (mode === "proxy") {
    const query = withS3AccountParam({ key }, selector);
    const url = buildApiUrl(
      `/browser/buckets/${encodeURIComponent(bucket)}/download`,
      query ?? undefined,
    );
    const response = await fetch(url, {
      headers: buildBrowserFetchHeaders(options, sseCustomerKeyBase64),
      credentials: "include",
      signal,
    });
    return readBrowserTransferStream(response, `Download failed for ${key}`);
  }
  const signedDownload = await presignDownload(params);
  const response = await fetch(signedDownload.url, {
    headers: signedDownload.headers || undefined,
    signal,
  });
  return readBrowserTransferStream(response, `Download failed for ${key}`);
};

export const uploadBrowserTransferBlob = async ({
  selector,
  bucket,
  key,
  mode,
  blob,
  contentType,
  signal,
  sseCustomerKeyBase64,
  options,
}: BrowserTransferUploadParams): Promise<void> => {
  if (mode === "proxy") {
    await proxyUpload(
      selector,
      bucket,
      key,
      blob,
      undefined,
      signal,
      sseCustomerKeyBase64,
      key.split("/").pop() || "upload.bin",
      options,
    );
    return;
  }
  const signedUpload = await presignObject(
    selector,
    bucket,
    {
      key,
      operation: "put_object",
      content_type: contentType ?? undefined,
      expires_in: 1800,
    },
    sseCustomerKeyBase64,
    options,
  );
  const method = signedUpload.method.toUpperCase();
  if (method !== "PUT") {
    throw new Error(`Unexpected presigned upload method: ${method}.`);
  }
  const response = await fetch(signedUpload.url, {
    method: "PUT",
    headers: {
      ...(signedUpload.headers || {}),
      ...(contentType ? { "Content-Type": contentType } : {}),
    },
    body: blob,
    signal,
  });
  await ensureSuccessfulBrowserTransferResponse(
    response,
    `Upload failed for ${key}`,
  );
};
