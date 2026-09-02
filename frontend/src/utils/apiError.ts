/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { isApiError } from "../api/client";

type ApiFailureKind = "timeout" | "unavailable" | "denied" | "invalid_response" | "unknown";

type ApiFailure = {
  kind: ApiFailureKind;
  message: string;
  retryable: boolean;
  status: number | null;
};

const SECRET_FIELD_PATTERN =
  /\b([A-Za-z0-9_.-]*(?:access[_-]?key|secret[_-]?key|session[_-]?token|security[_-]?token|token|password|credential|signature)[A-Za-z0-9_.-]*\s*[:=]\s*)(["']?)[^"'\s,;}\]]+/gi;
const BEARER_TOKEN_PATTERN = /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi;
const AWS_ACCESS_KEY_PATTERN = /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g;
const URL_PATTERN = /\b(?:https?|s3):\/\/[^\s"'<>]+/gi;
const HTTP_POOL_ENDPOINT_PATTERN = /\b(?:HTTP|HTTPS)ConnectionPool\(host=['"][^'"]+['"],\s*port=\d+\)/gi;
const QUERY_SECRET_PATTERN =
  /\b([A-Za-z0-9_.-]*(?:access[_-]?key|secret[_-]?key|security[_-]?token|token|password|credential|signature)[A-Za-z0-9_.-]*=)[^&\s"'<>]+/gi;
const NETWORK_UNAVAILABLE_PATTERN =
  /\b(?:network error|failed to fetch|load failed|connection (?:refused|reset)|econnrefused|enotfound|name or service not known)\b/i;
const TIMEOUT_MESSAGE_PATTERN = /\b(?:timed? out|timeout)\b/i;
const RECENT_WEBAUTHN_REQUIRED_DETAIL = "Recent WebAuthn verification required";

export function isCancelledError(error: unknown): boolean {
  if (error instanceof DOMException && error.name === "AbortError") return true;
  if (typeof error !== "object" || error === null) return false;
  const name = "name" in error ? String((error as { name?: unknown }).name ?? "") : "";
  const code = "code" in error ? String((error as { code?: unknown }).code ?? "") : "";
  return name === "CanceledError" || code === "ERR_CANCELED";
}

export function sanitizeErrorMessage(message: string, fallback = "Unexpected error"): string {
  const trimmed = message.trim();
  if (!trimmed) return fallback;
  const sanitized = trimmed
    .replace(BEARER_TOKEN_PATTERN, "Bearer [redacted]")
    .replace(SECRET_FIELD_PATTERN, (_match, prefix: string, quote: string) => `${prefix}${quote}[redacted]`)
    .replace(URL_PATTERN, "[redacted-url]")
    .replace(HTTP_POOL_ENDPOINT_PATTERN, "[redacted-endpoint]")
    .replace(QUERY_SECRET_PATTERN, "$1[redacted]")
    .replace(AWS_ACCESS_KEY_PATTERN, "[redacted-access-key]");
  return sanitized.trim() || fallback;
}

export function extractApiError(error: unknown, fallback: string): string {
  return classifyApiError(error, fallback).message;
}

export function isRecentWebAuthnRequired(error: unknown): boolean {
  if (!isApiError(error) || error.response?.status !== 403) return false;
  const detail = (error.response.data as { detail?: unknown } | undefined)?.detail;
  return detail === RECENT_WEBAUTHN_REQUIRED_DETAIL;
}

function formatFastApiValidationDetail(detail: unknown, fallback: string): string | null {
  if (!Array.isArray(detail)) return null;

  const issues = detail.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const { loc, msg } = entry as { loc?: unknown; msg?: unknown };
    if (typeof msg !== "string" || msg.trim().length === 0) return [];

    const location = Array.isArray(loc)
      ? loc
          .filter((part) => part !== "body")
          .filter((part): part is string | number =>
            typeof part === "string" || typeof part === "number"
          )
          .map(String)
          .filter(Boolean)
          .join(".")
      : "";
    const message = sanitizeErrorMessage(msg, fallback);
    return [location ? `${location}: ${message}` : message];
  });

  if (issues.length === 0) return null;
  const visibleIssues = issues.slice(0, 3);
  const remainingCount = issues.length - visibleIssues.length;
  const suffix =
    remainingCount > 0
      ? ` · ${remainingCount} more validation error${remainingCount === 1 ? "" : "s"}`
      : "";
  return `${visibleIssues.join(" · ")}${suffix}`;
}

export function classifyApiError(error: unknown, fallback: string): ApiFailure {
  if (isApiError(error)) {
    const status = error.response?.status ?? null;
    const code = String(error.code ?? "").toUpperCase();
    const lowLevelMessage = typeof error.message === "string" ? error.message : "";
    const detail = (error.response?.data as { detail?: unknown } | undefined)?.detail;
    const safeDetail =
      typeof detail === "string" && detail.trim().length > 0
        ? sanitizeErrorMessage(detail, fallback)
        : formatFastApiValidationDetail(detail, fallback);
    if (
      code === "ECONNABORTED" ||
      code === "ETIMEDOUT" ||
      status === 504 ||
      TIMEOUT_MESSAGE_PATTERN.test(lowLevelMessage)
    ) {
      return { kind: "timeout", message: safeDetail ?? fallback, retryable: true, status };
    }
    if (status === 503 || !error.response || NETWORK_UNAVAILABLE_PATTERN.test(lowLevelMessage)) {
      return { kind: "unavailable", message: safeDetail ?? fallback, retryable: true, status };
    }
    if (status === 502) {
      return { kind: "invalid_response", message: safeDetail ?? fallback, retryable: true, status };
    }
    if (status === 401 || status === 403) {
      return { kind: "denied", message: safeDetail ?? fallback, retryable: false, status };
    }
    if (safeDetail) {
      return { kind: "unknown", message: safeDetail, retryable: false, status };
    }
    if (typeof error.message === "string" && error.message.trim().length > 0) {
      return { kind: "unknown", message: sanitizeErrorMessage(error.message, fallback), retryable: false, status };
    }
    return { kind: "unknown", message: fallback, retryable: false, status };
  }
  if (error instanceof Error && typeof error.message === "string" && error.message.trim().length > 0) {
    if (TIMEOUT_MESSAGE_PATTERN.test(error.message)) {
      return { kind: "timeout", message: fallback, retryable: true, status: null };
    }
    if (NETWORK_UNAVAILABLE_PATTERN.test(error.message)) {
      return { kind: "unavailable", message: fallback, retryable: true, status: null };
    }
    return {
      kind: "unknown",
      message: sanitizeErrorMessage(error.message, fallback),
      retryable: false,
      status: null,
    };
  }
  return { kind: "unknown", message: fallback, retryable: false, status: null };
}

export function isApiFeatureNotImplemented(message: string | null | undefined): boolean {
  const normalized = String(message ?? "").toLowerCase();
  return normalized.includes("xnotimplemented") || normalized.includes("notimplemented") || normalized.includes("not implemented");
}
