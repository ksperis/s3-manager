/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import axios from "axios";

const SECRET_FIELD_PATTERN =
  /\b([A-Za-z0-9_.-]*(?:access[_-]?key|secret[_-]?key|session[_-]?token|security[_-]?token|token|password|credential|signature)[A-Za-z0-9_.-]*\s*[:=]\s*)(["']?)[^"'\s,;}\]]+/gi;
const BEARER_TOKEN_PATTERN = /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi;
const AWS_ACCESS_KEY_PATTERN = /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g;
const URL_PATTERN = /\b(?:https?|s3):\/\/[^\s"'<>]+/gi;
const QUERY_SECRET_PATTERN =
  /\b([A-Za-z0-9_.-]*(?:access[_-]?key|secret[_-]?key|security[_-]?token|token|password|credential|signature)[A-Za-z0-9_.-]*=)[^&\s"'<>]+/gi;

export function sanitizeErrorMessage(message: string, fallback = "Unexpected error"): string {
  const trimmed = message.trim();
  if (!trimmed) return fallback;
  const sanitized = trimmed
    .replace(BEARER_TOKEN_PATTERN, "Bearer [redacted]")
    .replace(SECRET_FIELD_PATTERN, (_match, prefix: string, quote: string) => `${prefix}${quote}[redacted]`)
    .replace(URL_PATTERN, "[redacted-url]")
    .replace(QUERY_SECRET_PATTERN, "$1[redacted]")
    .replace(AWS_ACCESS_KEY_PATTERN, "[redacted-access-key]");
  return sanitized.trim() || fallback;
}

export function extractApiError(error: unknown, fallback: string): string {
  if (axios.isAxiosError(error)) {
    const detail = (error.response?.data as { detail?: unknown } | undefined)?.detail;
    if (typeof detail === "string" && detail.trim().length > 0) {
      return sanitizeErrorMessage(detail, fallback);
    }
    if (typeof error.message === "string" && error.message.trim().length > 0) {
      return sanitizeErrorMessage(error.message, fallback);
    }
    return fallback;
  }
  if (error instanceof Error && typeof error.message === "string" && error.message.trim().length > 0) {
    return sanitizeErrorMessage(error.message, fallback);
  }
  return fallback;
}

export function isApiFeatureNotImplemented(message: string | null | undefined): boolean {
  const normalized = String(message ?? "").toLowerCase();
  return normalized.includes("xnotimplemented") || normalized.includes("notimplemented") || normalized.includes("not implemented");
}
