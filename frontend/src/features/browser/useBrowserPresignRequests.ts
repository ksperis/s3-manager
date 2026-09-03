/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useCallback } from "react";
import type { S3AccountSelector } from "../../api/accountParams";
import type { BrowserRequestOptions, StsCredentials } from "../../api/browser";
import {
  presignPart,
  type PresignPartRequest,
  type PresignPartResponse,
} from "../../api/browserMultipart";
import {
  presignObject,
  type PresignRequest,
  type PresignedUrl,
} from "../../api/browserTransfers";
import { presignObjectWithSts, presignPartWithSts } from "./stsPresigner";

type EnsureStsCredentials = (
  forceRefresh?: boolean,
) => Promise<StsCredentials | null>;

type UseBrowserPresignRequestsOptions = {
  accountId: S3AccountSelector;
  ensureStsCredentials: EnsureStsCredentials;
  requestOptions?: BrowserRequestOptions;
  sseCustomerKeyBase64: string | null;
  useStsPresigner: boolean;
};

async function tryStsPresign<T>(
  ensureCredentials: EnsureStsCredentials,
  presign: (credentials: StsCredentials) => Promise<T>,
): Promise<T | null> {
  const credentials = await ensureCredentials();
  if (!credentials) return null;
  try {
    return await presign(credentials);
  } catch {
    const refreshedCredentials = await ensureCredentials(true);
    if (!refreshedCredentials) return null;
    try {
      return await presign(refreshedCredentials);
    } catch {
      return null;
    }
  }
}

export function useBrowserPresignRequests({
  accountId,
  ensureStsCredentials,
  requestOptions,
  sseCustomerKeyBase64,
  useStsPresigner,
}: UseBrowserPresignRequestsOptions) {
  const presignObjectRequest = useCallback(
    async (
      bucketName: string,
      payload: PresignRequest,
    ): Promise<PresignedUrl> => {
      if (useStsPresigner) {
        const stsResponse = await tryStsPresign(
          ensureStsCredentials,
          (credentials) =>
            presignObjectWithSts(credentials, bucketName, payload),
        );
        if (stsResponse) return stsResponse;
      }
      return presignObject(
        accountId,
        bucketName,
        payload,
        sseCustomerKeyBase64,
        requestOptions,
      );
    },
    [
      accountId,
      ensureStsCredentials,
      requestOptions,
      sseCustomerKeyBase64,
      useStsPresigner,
    ],
  );

  const presignPartRequest = useCallback(
    async (
      bucketName: string,
      uploadId: string,
      payload: PresignPartRequest,
    ): Promise<PresignPartResponse> => {
      if (useStsPresigner) {
        const stsResponse = await tryStsPresign(
          ensureStsCredentials,
          (credentials) =>
            presignPartWithSts(credentials, bucketName, uploadId, payload),
        );
        if (stsResponse) return stsResponse;
      }
      return presignPart(
        accountId,
        bucketName,
        uploadId,
        payload,
        sseCustomerKeyBase64,
        requestOptions,
      );
    },
    [
      accountId,
      ensureStsCredentials,
      requestOptions,
      sseCustomerKeyBase64,
      useStsPresigner,
    ],
  );

  return { presignObjectRequest, presignPartRequest };
}
