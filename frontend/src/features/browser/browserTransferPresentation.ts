/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import type { BrowserSettings } from "../../api/browser";
import {
  DEFAULT_DIRECT_DOWNLOAD_PARALLELISM,
  DEFAULT_DIRECT_UPLOAD_PARALLELISM,
  DEFAULT_OTHER_OPERATIONS_PARALLELISM,
  DEFAULT_PROXY_DOWNLOAD_PARALLELISM,
  DEFAULT_PROXY_UPLOAD_PARALLELISM,
} from "./browserConstants";
import { clampParallelism } from "./browserUtils";

const STS_REFRESH_WINDOW_MS = 2 * 60 * 1000;
export const CORS_DIRECT_TRANSFER_WARNING =
  "Direct download/upload is not allowed on this bucket.";

type TransferParallelismSettings = Pick<
  BrowserSettings,
  | "direct_upload_parallelism"
  | "proxy_upload_parallelism"
  | "direct_download_parallelism"
  | "proxy_download_parallelism"
  | "other_operations_parallelism"
>;

type BrowserTransferParallelism = {
  upload: number;
  download: number;
  otherOperations: number;
};

type BrowserTransferAccessBadge = {
  label: string;
  title: string;
  tone: "danger" | "warning" | "info" | "success";
  indicatorClassName: string;
};

export function resolveBrowserTransferParallelism(
  settings: TransferParallelismSettings | null | undefined,
  useProxyTransfers: boolean,
): BrowserTransferParallelism {
  const uploadFallback = useProxyTransfers
    ? DEFAULT_PROXY_UPLOAD_PARALLELISM
    : DEFAULT_DIRECT_UPLOAD_PARALLELISM;
  const downloadFallback = useProxyTransfers
    ? DEFAULT_PROXY_DOWNLOAD_PARALLELISM
    : DEFAULT_DIRECT_DOWNLOAD_PARALLELISM;
  const uploadValue = useProxyTransfers
    ? settings?.proxy_upload_parallelism
    : settings?.direct_upload_parallelism;
  const downloadValue = useProxyTransfers
    ? settings?.proxy_download_parallelism
    : settings?.direct_download_parallelism;
  const otherOperationsValue =
    settings?.other_operations_parallelism ??
    DEFAULT_OTHER_OPERATIONS_PARALLELISM;

  return {
    upload: clampParallelism(uploadValue ?? uploadFallback, uploadFallback),
    download: clampParallelism(
      downloadValue ?? downloadFallback,
      downloadFallback,
    ),
    otherOperations: clampParallelism(
      otherOperationsValue,
      DEFAULT_OTHER_OPERATIONS_PARALLELISM,
    ),
  };
}

export function isStsCredentialsExpiring(
  expiration: string | null | undefined,
  nowMs = Date.now(),
): boolean {
  if (!expiration) return true;
  const expiresAt = new Date(expiration).getTime();
  if (Number.isNaN(expiresAt)) return true;
  return expiresAt - nowMs <= STS_REFRESH_WINDOW_MS;
}

type BrowserTransferWarningsInput = {
  warningMessage: string | null;
  corsFixError: string | null;
  stsCredentialsError: string | null;
  corsEnabled: boolean | null;
  proxyAllowed: boolean;
};

export function buildBrowserTransferWarnings({
  warningMessage,
  corsFixError,
  stsCredentialsError,
  corsEnabled,
  proxyAllowed,
}: BrowserTransferWarningsInput): string[] {
  const items = [warningMessage, corsFixError, stsCredentialsError].filter(
    (item): item is string => Boolean(item),
  );
  if (corsEnabled === false) {
    items.push(CORS_DIRECT_TRANSFER_WARNING);
    if (!proxyAllowed) {
      items.push("Proxy transfers are disabled in settings.");
    }
  }
  return items;
}

export function resolveLegacyStsTooltip({
  isLegacyContext,
  isLegacyConnectionContext,
}: {
  isLegacyContext: boolean;
  isLegacyConnectionContext: boolean;
}): string {
  if (!isLegacyContext) return "";
  return isLegacyConnectionContext
    ? "STS is not available for legacy S3 connections. Presigned URLs are used instead."
    : "STS is not available for legacy S3 users. Presigned URLs are used instead.";
}

type BrowserTransferAccessBadgeInput = {
  hasContext: boolean;
  corsEnabled: boolean | null;
  proxyAllowed: boolean;
  useProxyTransfers: boolean;
  sseActive: boolean;
  hasStsCredentials: boolean;
  stsExpirationLabel: string;
  legacyStsTooltip: string;
};

export function resolveBrowserTransferAccessBadge({
  hasContext,
  corsEnabled,
  proxyAllowed,
  useProxyTransfers,
  sseActive,
  hasStsCredentials,
  stsExpirationLabel,
  legacyStsTooltip,
}: BrowserTransferAccessBadgeInput): BrowserTransferAccessBadge | null {
  if (!hasContext) return null;
  if (corsEnabled === false && !proxyAllowed) {
    return {
      label: "Unavailable",
      title:
        "Download/Upload unavailable: CORS is disabled and proxy transfers are disabled.",
      tone: "danger",
      indicatorClassName:
        "border-rose-200/70 bg-rose-200/60 dark:border-rose-400/40 dark:bg-rose-400/25",
    };
  }
  if (useProxyTransfers) {
    return {
      label: "Proxy",
      title: "Download/Upload mode: Backend proxy transfers are active.",
      tone: "warning",
      indicatorClassName:
        "border-amber-200/70 bg-amber-200/60 dark:border-amber-400/40 dark:bg-amber-400/25",
    };
  }
  if (sseActive) {
    return {
      label: "SSE-C",
      title:
        "Download/Upload mode: SSE-C customer key is active for this bucket.",
      tone: "info",
      indicatorClassName:
        "border-sky-200/70 bg-sky-200/60 dark:border-sky-400/40 dark:bg-sky-400/25",
    };
  }
  if (hasStsCredentials) {
    return {
      label: "STS",
      title: stsExpirationLabel
        ? `Download/Upload mode: STS credentials active (expires at ${stsExpirationLabel}).`
        : "Download/Upload mode: STS credentials are active.",
      tone: "success",
      indicatorClassName:
        "border-emerald-200/70 bg-emerald-200/60 dark:border-emerald-400/40 dark:bg-emerald-400/25",
    };
  }
  return {
    label: "Presign",
    title: legacyStsTooltip
      ? `Download/Upload mode: Presigned URLs are active. ${legacyStsTooltip}`
      : "Download/Upload mode: Presigned URLs are active.",
    tone: "success",
    indicatorClassName:
      "border-emerald-200/70 bg-emerald-200/60 dark:border-emerald-400/40 dark:bg-emerald-400/25",
  };
}
