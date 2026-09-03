/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { S3AccountSelector } from "../../api/accountParams";
import type { BrowserRequestOptions } from "../../api/browser";
import {
  presignObject,
  type PresignedUrl,
} from "../../api/browserTransfers";
import { extractApiError } from "../../utils/apiError";
import { formatLocalDateTime } from "./browserUtils";
import { runBrowserScopedSave } from "./browserScopedSave";

type GenerateSignedUrlResult =
  | { status: "generated" }
  | { status: "api-error"; message: string }
  | { status: "validation-error" }
  | { status: "skipped" };

type CopySignedUrlResult =
  | { status: "copied" }
  | { status: "fallback"; value: string }
  | { status: "skipped" };

type UseBrowserObjectSignedUrlOptions = {
  accountId: S3AccountSelector;
  bucketName: string;
  objectKey: string;
  requestOptions?: BrowserRequestOptions;
  sseCustomerKeyBase64?: string | null;
};

const defaultExpiration = () =>
  formatLocalDateTime(new Date(Date.now() + 60 * 60 * 1000));

export function useBrowserObjectSignedUrl({
  accountId,
  bucketName,
  objectKey,
  requestOptions,
  sseCustomerKeyBase64,
}: UseBrowserObjectSignedUrlOptions) {
  const scope = JSON.stringify([
    accountId,
    bucketName,
    objectKey,
    requestOptions?.workspaceSurface ?? null,
    sseCustomerKeyBase64 ?? null,
  ]);
  const [expires, setExpires] = useState("");
  const [url, setUrl] = useState("");
  const [method, setMethod] = useState("");
  const [headers, setHeaders] = useState<PresignedUrl["headers"] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const scopeRef = useRef(scope);
  scopeRef.current = scope;

  const isCurrentScope = useCallback(
    () => scope === scopeRef.current,
    [scope],
  );

  const reset = useCallback(() => {
    setExpires(defaultExpiration());
    setUrl("");
    setMethod("");
    setHeaders(null);
    setError(null);
    setGenerating(false);
  }, []);

  const generate = useCallback(async (): Promise<GenerateSignedUrlResult> => {
    if (!isCurrentScope() || !accountId || !bucketName || !objectKey) {
      return { status: "skipped" };
    }
    setError(null);
    const expiresAt = expires ? new Date(expires) : null;
    if (!expiresAt || Number.isNaN(expiresAt.getTime())) {
      setError("Select a valid expiration date.");
      return { status: "validation-error" };
    }
    const seconds = Math.floor((expiresAt.getTime() - Date.now()) / 1000);
    if (seconds < 60) {
      setError("Expiration must be at least 1 minute from now.");
      return { status: "validation-error" };
    }
    if (seconds > 43200) {
      setError("Expiration must be within 12 hours.");
      return { status: "validation-error" };
    }

    try {
      const presigned = await runBrowserScopedSave(
        isCurrentScope,
        setGenerating,
        () =>
          presignObject(
            accountId,
            bucketName,
            {
              key: objectKey,
              operation: "get_object",
              expires_in: seconds,
            },
            sseCustomerKeyBase64,
            requestOptions,
          ),
      );
      if (!presigned) return { status: "skipped" };
      setUrl(presigned.url);
      setMethod(presigned.method);
      setHeaders(presigned.headers ?? null);
      return { status: "generated" };
    } catch (generateError) {
      if (!isCurrentScope()) return { status: "skipped" };
      const message = extractApiError(
        generateError,
        "Unable to generate signed URL.",
      );
      setError(message);
      return { status: "api-error", message };
    }
  }, [
    accountId,
    bucketName,
    expires,
    isCurrentScope,
    objectKey,
    requestOptions,
    sseCustomerKeyBase64,
  ]);

  const copy = useCallback(async (): Promise<CopySignedUrlResult> => {
    if (!isCurrentScope() || !url) return { status: "skipped" };
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(url);
      return isCurrentScope()
        ? { status: "copied" }
        : { status: "skipped" };
    }
    return { status: "fallback", value: url };
  }, [isCurrentScope, url]);

  useEffect(() => reset(), [reset, scope]);

  return {
    expires,
    setExpires,
    url,
    method,
    headers,
    error,
    generating,
    generate,
    copy,
  };
}
