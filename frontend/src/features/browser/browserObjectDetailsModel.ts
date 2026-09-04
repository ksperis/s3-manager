/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import type { ObjectTag } from "../../api/browserContracts";
import type { ObjectDetailsTabId } from "./browserTypes";
import { formatDateTime } from "./browserUtils";

export const ARCHIVE_STORAGE_CLASSES = new Set([
  "GLACIER",
  "GLACIER_IR",
  "DEEP_ARCHIVE",
]);

export const normalizeObjectDetailPairs = (items: ObjectTag[]) =>
  items.reduce<Record<string, string>>((acc, item) => {
    const key = item.key.trim();
    if (!key) return acc;
    acc[key] = item.value ?? "";
    return acc;
  }, {});

export const formatRestoreStatus = (value?: string | null) => {
  if (!value) return null;
  const normalized = value.toLowerCase();
  if (normalized.includes('ongoing-request="true"')) {
    return "Restore in progress.";
  }
  if (normalized.includes('ongoing-request="false"')) {
    const expiryMatch = value.match(/expiry-date="([^"]+)"/i);
    if (!expiryMatch?.[1]) {
      return "Temporary restore is available.";
    }
    return `Temporary restore available until ${formatDateTime(
      expiryMatch[1],
    )}.`;
  }
  return value;
};

export const OBJECT_LOCK_DISABLED_MESSAGE =
  "Object Lock is not enabled on this bucket. Legal hold and retention settings are unavailable.";

export const isObjectLockUnavailableMessage = (message: string) => {
  const normalized = message.toLowerCase();
  return (
    normalized.includes("object lock") &&
    (normalized.includes("not configured") ||
      normalized.includes("not enabled") ||
      normalized.includes("not found") ||
      normalized.includes("invalidrequest"))
  );
};

export const nextTabAfterDeleted = (versioningEnabled: boolean): ObjectDetailsTabId =>
  versioningEnabled ? "versions" : "preview";

export const DELETED_OBJECT_DETAILS_MESSAGE =
  "This object is deleted. Open versions to inspect or restore it.";

export function resolveBrowserObjectDetailsTab({
  isDeleted,
  isStorageSpace,
  profile,
  requestedTab,
  versioningEnabled,
}: {
  isDeleted: boolean;
  isStorageSpace: boolean;
  profile: "standard" | "advanced";
  requestedTab: ObjectDetailsTabId;
  versioningEnabled: boolean;
}): { initialTab: ObjectDetailsTabId | null; warning?: string } {
  if (isDeleted) {
    return {
      initialTab: versioningEnabled || isStorageSpace ? "versions" : null,
      warning: DELETED_OBJECT_DETAILS_MESSAGE,
    };
  }
  if (requestedTab === "versions" && !versioningEnabled && !isStorageSpace) {
    return { initialTab: "preview" };
  }
  if (profile === "advanced" && requestedTab === "details") {
    return { initialTab: "properties" };
  }
  if (
    profile === "standard" &&
    requestedTab !== "preview" &&
    requestedTab !== "details"
  ) {
    return { initialTab: "details" };
  }
  return { initialTab: requestedTab };
}

export function resolveRoutedObjectDetailsTab({
  isDeleted,
  requestedTab,
}: {
  isDeleted: boolean;
  requestedTab: ObjectDetailsTabId;
}): "preview" | "properties" | "versions" {
  if (isDeleted) return "versions";
  if (
    requestedTab === "preview" ||
    requestedTab === "properties" ||
    requestedTab === "versions"
  ) {
    return requestedTab;
  }
  return "properties";
}

type BrowserObjectDetailsTab = {
  id: ObjectDetailsTabId;
  label: string;
};

export const buildObjectDetailsTabs = ({
  hasArchiveTab,
  isDeleted,
  profile,
  versioningEnabled,
}: {
  hasArchiveTab: boolean;
  isDeleted: boolean;
  profile: "standard" | "advanced";
  versioningEnabled: boolean;
}): BrowserObjectDetailsTab[] => {
  if (isDeleted) {
    return versioningEnabled ? [{ id: "versions", label: "Versions" }] : [];
  }

  const tabs: BrowserObjectDetailsTab[] = [{ id: "preview", label: "Preview" }];
  if (profile === "standard") {
    tabs.push({ id: "details", label: "Details" });
    return tabs;
  }
  if (versioningEnabled) {
    tabs.push({ id: "versions", label: "Versions" });
  }
  tabs.push({ id: "properties", label: "Properties" });
  tabs.push({ id: "protection", label: "Access & Protection" });
  if (hasArchiveTab) {
    tabs.push({ id: "archive", label: "Archive" });
  }
  return tabs;
};

export const buildInlinePreviewDisposition = (filename: string) => {
  const fallback = filename.replace(/[^\x20-\x7E]+/g, "_").replace(/"/g, '\\"');
  const encoded = encodeURIComponent(filename);
  return `inline; filename="${fallback || "preview"}"; filename*=UTF-8''${encoded}`;
};
