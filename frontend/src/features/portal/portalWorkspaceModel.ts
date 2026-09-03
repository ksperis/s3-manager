/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import type { PortalAccount } from "../../api/portal";
import type {
  PortalStorageSpaceAccountMemberRole,
  PortalStorageSpaceCollaboratorPreview,
  PortalStorageSpaceShareScope,
  PortalStorageSpaceSummary,
  PortalStorageSpaceVisibility,
} from "../../api/portal";
import type { PortalUsage } from "../../api/portalUsage";
import type { UiLanguage } from "../../components/language";
import type { StorageSpaceIconDescriptor } from "../../api/storageSpaceIcons";
import { translate, type I18nMessage } from "../../i18n";
import { portalDateLabel } from "./portalI18n";

type TFunction = (message: I18nMessage) => string;

export type PortalWorkspaceRole = "Viewer" | "Editor" | "Owner" | "Manager";
export type PortalWorkspaceStatus = "Active" | "Attention";
export type PortalWorkspaceAccess = "Private" | "Shared" | "Public" | "Public Read" | "Unavailable";
export type PortalWorkspaceAlertTone = "info" | "warning" | "danger";

export type PortalWorkspaceSpace = {
  id: string;
  name: string;
  internalName: string | null;
  origin: "portal_generic" | "portal_named" | "imported";
  nameEditable: boolean;
  description: string;
  ownerLabel: string | null;
  ownerUserId: number | null;
  collaborators: PortalStorageSpaceCollaboratorPreview[];
  collaboratorCount: number;
  visibility: PortalStorageSpaceVisibility;
  shareScope: PortalStorageSpaceShareScope;
  accountMemberRole: PortalStorageSpaceAccountMemberRole | null;
  projectKey: string | null;
  datasetLabel: string | null;
  role: PortalWorkspaceRole;
  canBrowse: boolean;
  canDelete: boolean;
  canTakeOwnership: boolean;
  status: PortalWorkspaceStatus | "Archived";
  access: PortalWorkspaceAccess;
  region: string | null;
  createdLabel: string;
  usedBytes?: number | null;
  quotaBytes?: number | null;
  quotaObjects?: number | null;
  objectCount?: number | null;
  createdAt?: string | null;
  archivedAt?: string | null;
  shareCount: number | null;
  icon: StorageSpaceIconDescriptor;
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
  if (space.role === "Manager" || space.role === "Owner" || space.role === "Editor" || space.role === "Viewer") {
    return space.role;
  }
  return "Viewer";
}

function statusFromStorageSpace(space: PortalStorageSpaceSummary): PortalWorkspaceStatus {
  if (space.status === "Active" || space.status === "Attention") {
    return space.status;
  }
  if (typeof space.status === "string" && ["attention", "warning", "degraded"].includes(space.status.toLowerCase())) {
    return "Attention";
  }
  return "Active";
}

function visibilityFromStorageSpace(space: PortalStorageSpaceSummary): PortalStorageSpaceVisibility {
  if (space.visibility === "shared") return "shared";
  return "private";
}

function createdLabel(raw?: string | null, locale: UiLanguage = "en"): string {
  return portalDateLabel(raw, locale);
}

function knownSum(values: Array<number | null | undefined>): number | null {
  const known = values.filter((value): value is number => value != null);
  if (known.length === 0) return null;
  return known.reduce((sum, value) => sum + value, 0);
}

export function storageSpacePath(space: Pick<PortalWorkspaceSpace, "id">): string {
  return `/portal/storage-spaces/${encodeURIComponent(space.id)}`;
}

export function decodePortalRouteValue(value?: string): string {
  if (!value) return "";
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function decodePortalObjectPath(value?: string): string {
  if (!value) return "";
  return value
    .split("/")
    .map((part) => decodePortalRouteValue(part))
    .join("/");
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
  storageSpaces,
  usage,
  userEmail,
  locale = "en",
  t = translate,
}: {
  account: PortalAccount | null;
  storageSpaces?: PortalStorageSpaceSummary[] | null;
  usage: PortalUsage | null;
  userEmail: string | null;
  locale?: UiLanguage;
  t?: TFunction;
}): PortalWorkspaceModel {
  const accountName = account?.name ?? userEmail?.split("@")[0] ?? "Portal";
  const usageBySpace = new Map((usage?.storage_spaces ?? []).map((space) => [space.id, space]));
  const spaces = (storageSpaces ?? []).map((storageSpace) => {
    const usageSpace = usageBySpace.get(storageSpace.id);
    const role = roleFromStorageSpace(storageSpace);
    const canBrowse = storageSpace.can_browse ?? true;
    const name = storageSpace.name || prettyName(storageSpace.id);
    const visibility = visibilityFromStorageSpace(storageSpace);
    const shareScope: PortalStorageSpaceShareScope =
      visibility === "shared" && storageSpace.share_scope === "account" ? "account" : "restricted";
    const status: PortalWorkspaceStatus | "Archived" = storageSpace.archived_at
      ? "Archived"
      : statusFromStorageSpace(storageSpace);
    const access: PortalWorkspaceAccess = visibility === "shared" ? "Shared" : "Private";
    return {
      id: storageSpace.id,
      name: usageSpace?.name ?? name,
      internalName: storageSpace.internal_bucket_name ?? null,
      origin: storageSpace.origin ?? "imported",
      nameEditable: Boolean(storageSpace.name_editable),
      description: storageSpace.description ?? t({ en: `${name} storage space`, fr: `Espace de stockage ${name}`, de: `Speicherbereich ${name}` }),
      ownerLabel: storageSpace.owner_label ?? null,
      ownerUserId: storageSpace.owner_user_id ?? null,
      collaborators: storageSpace.collaborators ?? [],
      collaboratorCount: storageSpace.collaborator_count ?? storageSpace.collaborators?.length ?? 0,
      visibility,
      shareScope,
      accountMemberRole: shareScope === "account" ? storageSpace.account_member_role ?? "Editor" : null,
      projectKey: storageSpace.project_key ?? null,
      datasetLabel: storageSpace.dataset_label ?? null,
      role,
      canBrowse,
      canDelete: Boolean(storageSpace.can_delete),
      canTakeOwnership: Boolean(storageSpace.can_take_ownership),
      status,
      access,
      region: storageSpace.region ?? null,
      createdLabel: createdLabel(storageSpace.created_at, locale),
      usedBytes: usageSpace?.used_bytes ?? storageSpace.used_bytes ?? null,
      quotaBytes: usageSpace?.quota_max_size_bytes ?? storageSpace.quota_max_size_bytes ?? null,
      quotaObjects: usageSpace?.quota_max_objects ?? storageSpace.quota_max_objects ?? null,
      objectCount: usageSpace?.object_count ?? storageSpace.object_count ?? null,
      createdAt: storageSpace.created_at ?? null,
      archivedAt: storageSpace.archived_at ?? null,
      shareCount: null,
      icon: storageSpace.icon ?? { source: "preset", preset: "bucket" },
    };
  });

  const spaceUsedBytes = knownSum(spaces.map((space) => space.usedBytes));
  const spaceObjectCount = knownSum(spaces.map((space) => space.objectCount));

  return {
    accountName,
    userEmail,
    spaces,
    activity: [],
    alerts: [],
    usageTrend: [],
    usedBytes: usage?.used_bytes ?? spaceUsedBytes,
    usedObjects: usage?.used_objects ?? spaceObjectCount,
    quotaBytes: usage?.quota_max_size_bytes ?? null,
    quotaObjects: usage?.quota_max_objects ?? null,
    maxBuckets: usage?.max_buckets ?? null,
    requestCount: null,
    dataInBytes: null,
    dataOutBytes: null,
  };
}
