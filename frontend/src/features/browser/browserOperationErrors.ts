/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import axios from "axios";

type BrowserErrorDetails = { code?: string; message?: string };

const readErrorDetails = (candidate: {
  code?: unknown;
  errorCode?: unknown;
  error_code?: unknown;
  message?: unknown;
  detail?: unknown;
  error?: unknown;
}): BrowserErrorDetails | null => {
  const code =
    typeof candidate.code === "string"
      ? candidate.code
      : typeof candidate.errorCode === "string"
        ? candidate.errorCode
        : typeof candidate.error_code === "string"
          ? candidate.error_code
          : undefined;
  const message =
    typeof candidate.message === "string"
      ? candidate.message
      : typeof candidate.detail === "string"
        ? candidate.detail
        : typeof candidate.error === "string"
          ? candidate.error
          : undefined;
  return code || message ? { code, message } : null;
};

export const extractBrowserErrorDetails = (
  payload: unknown,
): BrowserErrorDetails | null => {
  if (!payload) return null;
  if (typeof payload === "string") {
    const trimmed = payload.trim();
    if (!trimmed) return null;
    if (trimmed.startsWith("{")) {
      try {
        const parsed = JSON.parse(trimmed) as unknown;
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          const details = readErrorDetails(parsed);
          if (details) return details;
        }
      } catch {
        // Continue with XML and plain-text parsing.
      }
    }
    const code = trimmed.match(/<Code>([^<]+)<\/Code>/)?.[1];
    const message = trimmed.match(/<Message>([^<]+)<\/Message>/)?.[1];
    return code || message ? { code, message } : { message: trimmed.slice(0, 300) };
  }
  if (typeof payload === "object" && !Array.isArray(payload)) {
    return readErrorDetails(payload as Record<string, unknown>);
  }
  return null;
};

const normalizeContext = (value: string) =>
  value.trim().replace(/[.:]\s*$/, "");

export const formatBrowserOperationError = (
  error: unknown,
  fallback: string,
  context?: string,
) => {
  let detail: string | undefined;
  if (axios.isAxiosError(error)) {
    const status = error.response?.status;
    const statusText = error.response?.statusText;
    const statusLabel = status
      ? `HTTP ${status}${statusText ? ` ${statusText}` : ""}`
      : "";
    const parsed = extractBrowserErrorDetails(error.response?.data);
    const message =
      parsed?.code && parsed.message
        ? `${parsed.code}: ${parsed.message}`
        : parsed?.message || parsed?.code;
    const parts = [statusLabel, message || error.message].filter(Boolean);
    detail = parts.length > 0 ? parts.join(" - ") : undefined;
  } else if (error instanceof Error && error.message) {
    detail = error.message;
  } else if (typeof error === "string" && error.trim()) {
    detail = error;
  } else if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string" && message.trim()) detail = message;
  }

  const message = detail ?? fallback;
  if (!context) return message;
  const normalizedContext = normalizeContext(context);
  if (!detail && normalizedContext === normalizeContext(fallback)) return fallback;
  return `${normalizedContext}: ${message}`;
};
