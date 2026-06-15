/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import type { S3Account } from "../../api/accounts";
import type { PortalState, PortalStorageSpaceSummary, PortalUsage } from "../../api/portal";

export type PortalWorkspaceRole = "Viewer" | "Editor" | "Owner";
export type PortalWorkspaceStatus = "Active" | "Attention" | "Shared";
export type PortalWorkspaceAccess = "Private" | "Public" | "Public Read" | "Unavailable";
export type PortalWorkspaceAlertTone = "info" | "warning" | "danger";

export type PortalWorkspaceFile = {
  id: string;
  name: string;
  kind: "folder" | "file";
  path: string;
  sizeBytes?: number | null;
  updatedLabel: string;
  ownerLabel: string;
  mimeType?: string;
  typeLabel?: string;
};

export type PortalWorkspaceSpace = {
  id: string;
  name: string;
  internalName: string | null;
  origin: "legacy" | "portal_generic" | "portal_named" | "imported";
  nameEditable: boolean;
  description: string;
  ownerLabel: string | null;
  spaceType: string | null;
  projectKey: string | null;
  datasetLabel: string | null;
  role: PortalWorkspaceRole;
  status: PortalWorkspaceStatus | "Archived";
  access: PortalWorkspaceAccess;
  region: string | null;
  createdLabel: string;
  usedBytes?: number | null;
  quotaBytes?: number | null;
  objectCount?: number | null;
  createdAt?: string | null;
  archivedAt?: string | null;
  shareCount: number | null;
};

export type PortalWorkspaceActivityItem = {
  id: string;
  actor: string;
  action: string;
  target: string;
  spaceId?: string;
  spaceName?: string;
  timeLabel: string;
  ipAddress: string;
};

export type PortalWorkspaceTransfer = {
  id: string;
  name: string;
  direction: "Upload" | "Download";
  status: "Completed" | "Uploading" | "Queued" | "Failed";
  progress: number;
  sizeBytes?: number | null;
  spaceName: string;
  startedLabel: string;
  etaLabel: string;
  speedLabel: string;
  errorMessage?: string | null;
};

export type PortalWorkspaceAlert = {
  id: string;
  tone: PortalWorkspaceAlertTone;
  title: string;
  description: string;
  severityLabel: string;
};

export type PortalWorkspaceTrendPoint = {
  label: string;
  value: number;
};

export type PortalWorkspaceModel = {
  accountName: string;
  userEmail: string | null;
  spaces: PortalWorkspaceSpace[];
  activity: PortalWorkspaceActivityItem[];
  transfers: PortalWorkspaceTransfer[];
  alerts: PortalWorkspaceAlert[];
  usageTrend: PortalWorkspaceTrendPoint[];
  usedBytes?: number | null;
  usedObjects?: number | null;
  quotaBytes?: number | null;
  quotaObjects?: number | null;
  maxBuckets?: number | null;
  requestCount?: number | null;
  dataInBytes?: number | null;
  dataOutBytes?: number | null;
};

function prettyName(raw: string): string {
  const cleaned = raw
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return raw;
  return cleaned
    .split(" ")
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))
    .join(" ");
}

function roleFromStorageSpace(space: PortalStorageSpaceSummary): PortalWorkspaceRole {
  if (space.role === "Owner" || space.role === "Editor" || space.role === "Viewer") {
    return space.role;
  }
  return "Viewer";
}

function statusFromStorageSpace(space: PortalStorageSpaceSummary, role: PortalWorkspaceRole): PortalWorkspaceStatus {
  if (space.status === "Active" || space.status === "Attention" || space.status === "Shared") {
    return space.status;
  }
  if (typeof space.status === "string" && ["attention", "warning", "degraded"].includes(space.status.toLowerCase())) {
    return "Attention";
  }
  return role === "Owner" ? "Active" : "Shared";
}

function createdLabel(raw?: string | null): string {
  if (!raw) return "-";
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return "-";
  return parsed.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function knownSum(values: Array<number | null | undefined>): number | null {
  const known = values.filter((value): value is number => value != null);
  if (known.length === 0) return null;
  return known.reduce((sum, value) => sum + value, 0);
}

export function storageSpacePath(space: Pick<PortalWorkspaceSpace, "id">): string {
  return `/portal/storage-spaces/${encodeURIComponent(space.id)}`;
}

export function storageSpaceObjectPath(space: Pick<PortalWorkspaceSpace, "id">, objectPath: string): string {
  const encodedObjectPath = objectPath
    .split("/")
    .filter(Boolean)
    .map((part) => encodeURIComponent(part))
    .join("/");
  return `${storageSpacePath(space)}/objects/${encodedObjectPath}`;
}

export function buildPortalWorkspaceModel({
  account,
  state,
  storageSpaces,
  usage,
  userEmail,
}: {
  account: S3Account | null;
  state: PortalState | null;
  storageSpaces?: PortalStorageSpaceSummary[] | null;
  usage: PortalUsage | null;
  userEmail: string | null;
}): PortalWorkspaceModel {
  const accountName = account?.name ?? userEmail?.split("@")[0] ?? "Portal";
  const usageBySpace = new Map((usage?.storage_spaces ?? []).map((space) => [space.id, space]));
  const spaces = (storageSpaces ?? []).map((storageSpace) => {
    const usageSpace = usageBySpace.get(storageSpace.id);
    const role = roleFromStorageSpace(storageSpace);
    const name = storageSpace.name || prettyName(storageSpace.id);
    return {
      id: storageSpace.id,
      name: usageSpace?.name ?? name,
      internalName: storageSpace.internal_bucket_name ?? null,
      origin: storageSpace.origin ?? "legacy",
      nameEditable: Boolean(storageSpace.name_editable),
      description: storageSpace.description ?? `${name} storage space`,
      ownerLabel: storageSpace.owner_label ?? null,
      spaceType: storageSpace.space_type ?? null,
      projectKey: storageSpace.project_key ?? null,
      datasetLabel: storageSpace.dataset_label ?? null,
      role,
      status: storageSpace.archived_at ? "Archived" : statusFromStorageSpace(storageSpace, role),
      access: "Unavailable" as const,
      region: storageSpace.region ?? null,
      createdLabel: createdLabel(storageSpace.created_at),
      usedBytes: usageSpace?.used_bytes ?? storageSpace.used_bytes ?? null,
      quotaBytes: usageSpace?.quota_max_size_bytes ?? storageSpace.quota_max_size_bytes ?? null,
      objectCount: usageSpace?.object_count ?? storageSpace.object_count ?? null,
      createdAt: storageSpace.created_at ?? null,
      archivedAt: storageSpace.archived_at ?? null,
      shareCount: null,
    };
  });

  const spaceUsedBytes = knownSum(spaces.map((space) => space.usedBytes));
  const spaceObjectCount = knownSum(spaces.map((space) => space.objectCount));

  return {
    accountName,
    userEmail,
    spaces,
    activity: [],
    transfers: [],
    alerts: [],
    usageTrend: [],
    usedBytes: usage?.used_bytes ?? state?.used_bytes ?? spaceUsedBytes,
    usedObjects: usage?.used_objects ?? state?.used_objects ?? spaceObjectCount,
    quotaBytes: usage?.quota_max_size_bytes ?? state?.quota_max_size_bytes ?? null,
    quotaObjects: usage?.quota_max_objects ?? state?.quota_max_objects ?? null,
    maxBuckets: state?.max_buckets ?? null,
    requestCount: null,
    dataInBytes: null,
    dataOutBytes: null,
  };
}
