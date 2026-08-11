/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { extractBrowserErrorDetails } from "./browserOperationErrors";

const formatBrowserFetchTransferError = async (
  response: Response,
  fallback: string,
): Promise<string> => {
  let detail: string | undefined;
  let code: string | undefined;
  try {
    const parsed = extractBrowserErrorDetails(await response.text());
    code = parsed?.code;
    detail = parsed?.message;
  } catch {
    // A status-only error remains actionable when the response body is unreadable.
  }
  const statusLabel = `HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ""}`;
  const detailLabel = code && detail ? `${code}: ${detail}` : detail || code;
  const parts = [statusLabel, detailLabel].filter(Boolean);
  const suffix = parts.length > 0 ? `: ${parts.join(" - ")}` : "";
  return `${fallback}${suffix}`;
};

export const ensureSuccessfulBrowserTransferResponse = async (
  response: Response,
  fallback: string,
): Promise<Response> => {
  if (!response.ok) {
    throw new Error(await formatBrowserFetchTransferError(response, fallback));
  }
  return response;
};

export const readBrowserTransferBlob = async (
  response: Response,
  fallback: string,
): Promise<Blob> => {
  await ensureSuccessfulBrowserTransferResponse(response, fallback);
  return response.blob();
};

export const readBrowserTransferStream = async (
  response: Response,
  fallback: string,
): Promise<ReadableStream<Uint8Array>> => {
  await ensureSuccessfulBrowserTransferResponse(response, fallback);
  if (!response.body) {
    throw new Error("Streaming download is not supported in this browser.");
  }
  return response.body;
};
