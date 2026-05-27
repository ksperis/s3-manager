/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import type { Bucket } from "../../api/buckets";
import type { S3Account } from "../../api/accounts";
import type { PortalState, PortalStorageSpaceSummary, PortalUsage } from "../../api/portal";

export type PortalWorkspaceRole = "Viewer" | "Editor" | "Owner";
export type PortalWorkspaceStatus = "Active" | "Attention" | "Shared";
export type PortalWorkspaceAccess = "Private" | "Public" | "Public Read";
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

export type PortalWorkspaceObjectVersion = {
  id: string;
  sizeBytes: number;
  lastModified: string;
  actionLabel: string;
  current?: boolean;
};

export type PortalWorkspaceObjectEvent = {
  id: string;
  label: string;
  actor: string;
  timeLabel: string;
};

export type PortalWorkspaceObjectDetail = {
  name: string;
  path: string;
  sizeBytes: number;
  type: string;
  lastModified: string;
  etag: string;
  storageClass: string;
  encryption: string;
  objectUrl: string;
  downloadUrl: string;
  versions: PortalWorkspaceObjectVersion[];
  events: PortalWorkspaceObjectEvent[];
  previewLines: string[];
};

export type PortalWorkspaceSpace = {
  id: string;
  name: string;
  internalName: string;
  description: string;
  role: PortalWorkspaceRole;
  status: PortalWorkspaceStatus;
  access: PortalWorkspaceAccess;
  region: string;
  createdLabel: string;
  usedBytes?: number | null;
  quotaBytes?: number | null;
  objectCount?: number | null;
  createdAt?: string | null;
  shareCount: number;
  defaultPrefix: string;
  files: PortalWorkspaceFile[];
  objectDetail: PortalWorkspaceObjectDetail;
};

export type PortalWorkspaceShare = {
  id: string;
  spaceId: string;
  spaceName: string;
  person: string;
  access: PortalWorkspaceRole;
  direction: "with_me" | "by_me" | "public_link";
  expiresLabel?: string;
  activityLabel: string;
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

export type PortalWorkspaceAdminUser = {
  username: string;
  groups: string;
  status: "Active" | "Inactive";
  mfa: "Enabled" | "Disabled";
  lastActive: string;
};

export type PortalWorkspaceGroup = {
  name: string;
  users: number;
  policies: number;
  description: string;
};

export type PortalWorkspacePolicy = {
  name: string;
  type: "Managed" | "Custom";
  usedBy: string;
  lastModified: string;
};

export type PortalWorkspaceAccessKey = {
  name: string;
  owner: string;
  status: "Active" | "Inactive";
  created: string;
  lastUsed: string;
};

export type PortalWorkspaceModel = {
  accountName: string;
  userEmail: string | null;
  spaces: PortalWorkspaceSpace[];
  sharesWithMe: PortalWorkspaceShare[];
  sharesByMe: PortalWorkspaceShare[];
  publicLinks: PortalWorkspaceShare[];
  activity: PortalWorkspaceActivityItem[];
  transfers: PortalWorkspaceTransfer[];
  alerts: PortalWorkspaceAlert[];
  usageTrend: PortalWorkspaceTrendPoint[];
  adminUsers: PortalWorkspaceAdminUser[];
  groups: PortalWorkspaceGroup[];
  policies: PortalWorkspacePolicy[];
  accessKeys: PortalWorkspaceAccessKey[];
  usedBytes?: number | null;
  usedObjects?: number | null;
  quotaBytes?: number | null;
  quotaObjects?: number | null;
  requestCount: number;
  dataInBytes: number;
  dataOutBytes: number;
};

const TB = 1024 ** 4;
const GB = 1024 ** 3;
const MB = 1024 ** 2;

const GENOMICS_BUCKET: Bucket = {
  name: "genomics-2026",
  creation_date: "2024-03-12T10:00:00Z",
  used_bytes: 3.42 * TB,
  object_count: 12_800_000,
};

const FALLBACK_BUCKETS: Bucket[] = [
  GENOMICS_BUCKET,
  { name: "photos", creation_date: "2023-05-10T10:00:00Z", used_bytes: 3.2 * TB, object_count: 2_800_000 },
  { name: "backups", creation_date: "2023-06-03T10:00:00Z", used_bytes: 2.8 * TB, object_count: 1_200_000 },
  { name: "datasets", creation_date: "2023-03-16T10:00:00Z", used_bytes: 1.7 * TB, object_count: 1_500_000 },
  { name: "archive", creation_date: "2023-01-05T10:00:00Z", used_bytes: 0.5 * TB, object_count: 245_000 },
  { name: "logs", creation_date: "2023-04-13T10:00:00Z", used_bytes: 0.2 * TB, object_count: 121_000 },
  { name: "public-data", creation_date: "2023-02-10T10:00:00Z", used_bytes: 120 * GB, object_count: 532_000 },
  { name: "tmp", creation_date: "2023-05-28T10:00:00Z", used_bytes: 16 * GB, object_count: 89_000 },
  { name: "website-assets", creation_date: "2023-07-07T10:00:00Z", used_bytes: 15 * GB, object_count: 245_000 },
];

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

function compactName(raw: string): string {
  return raw.replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-+|-+$/g, "").toLowerCase() || "space";
}

function isGenomicsSpace(spaceId: string, spaceName: string): boolean {
  return compactName(spaceId) === "genomics-2026" || compactName(spaceName) === "genomics-2026";
}

function percent(used?: number | null, quota?: number | null): number | null {
  if (used == null || quota == null || quota <= 0) return null;
  return Math.min(100, Math.max(0, (used / quota) * 100));
}

function roleFromState(state: PortalState | null, index: number): PortalWorkspaceRole {
  if (!state || state.account_role === "portal_manager" || state.can_manage_buckets) return "Owner";
  return index % 3 === 0 ? "Editor" : "Viewer";
}

function roleFromStorageSpace(space: PortalStorageSpaceSummary): PortalWorkspaceRole {
  if (space.role === "Owner" || space.role === "Editor" || space.role === "Viewer") {
    return space.role;
  }
  return "Viewer";
}

function statusForBucket(bucket: Bucket, role: PortalWorkspaceRole): PortalWorkspaceStatus {
  if (role !== "Owner") return "Shared";
  const usage = percent(bucket.used_bytes, bucket.quota_max_size_bytes);
  if (usage != null && usage >= 85) return "Attention";
  return "Active";
}

function statusForStorageSpace(space: PortalStorageSpaceSummary, role: PortalWorkspaceRole): PortalWorkspaceStatus {
  if (space.status === "Active" || space.status === "Attention" || space.status === "Shared") {
    return space.status;
  }
  const usage = percent(space.used_bytes, space.quota_max_size_bytes);
  if (usage != null && usage >= 85) return "Attention";
  return role === "Owner" ? "Active" : "Shared";
}

function accessForBucket(bucket: Bucket, index: number): PortalWorkspaceAccess {
  if (bucket.name.includes("public")) return "Public";
  if (bucket.name.includes("website")) return "Public Read";
  return index % 5 === 0 ? "Public" : "Private";
}

function accessForStorageSpace(space: PortalStorageSpaceSummary, index: number): PortalWorkspaceAccess {
  const bucketName = space.internal_bucket_name ?? space.id;
  if (bucketName.includes("public")) return "Public";
  if (bucketName.includes("website")) return "Public Read";
  return index % 5 === 0 ? "Public" : "Private";
}

function createdLabel(raw?: string | null): string {
  if (!raw) return "May 10, 2023";
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return "May 10, 2023";
  return parsed.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function buildObjectDetail(spaceId: string, spaceName: string, index: number): PortalWorkspaceObjectDetail {
  if (isGenomicsSpace(spaceId, spaceName)) {
    const path = "raw-data/2024/03/sample_001.fastq.gz";
    return {
      name: "sample_001.fastq.gz",
      path,
      sizeBytes: 2.4 * GB,
      type: "application/gzip",
      lastModified: "12 mars 2024, 10:15:43",
      etag: "\"a1b2c3d4e5f678901234567890abcdef\"",
      storageClass: "STANDARD",
      encryption: "AES256 (SSE-S3)",
      objectUrl: `s3://${spaceId}/${path}`,
      downloadUrl: `https://s3.example.com/${spaceId}/${path}?download=1`,
      versions: [
        { id: "null (actuelle)", sizeBytes: 2.4 * GB, lastModified: "12 mars 2024, 10:15:43", actionLabel: "Actuelle", current: true },
        { id: "4f2a1c...b8e9", sizeBytes: 2.4 * GB, lastModified: "11 mars 2024, 18:22:11", actionLabel: "Restaurer" },
        { id: "9c7d2e...f1a3", sizeBytes: 2.4 * GB, lastModified: "10 mars 2024, 09:11:05", actionLabel: "Restaurer" },
      ],
      events: [
        { id: "downloaded", label: "Objet téléchargé", actor: "Alice", timeLabel: "Il y a 2 min" },
        { id: "shared", label: "Objet partagé", actor: "genomics-team", timeLabel: "Il y a 1 h" },
        { id: "uploaded", label: "Objet téléchargé", actor: "Bob", timeLabel: "Il y a 3 h" },
      ],
      previewLines: [
        "@SEQ_ID_001",
        "GATTGGGGTTCAAGCAGTATCGATCAAAATAGCGGCCGTGCAGCCCCCGCAAAA...",
        "+",
        "FFFAFJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJ...",
      ],
    };
  }
  const base = compactName(spaceName);
  const fileName = index === 0 ? "image_001.jpg" : `${base}_report.pdf`;
  const path = index === 0 ? `${base}/2024/${fileName}` : `${base}/documents/${fileName}`;
  return {
    name: fileName,
    path,
    sizeBytes: index === 0 ? 4.2 * MB : 2.4 * MB,
    type: index === 0 ? "image/jpeg" : "application/pdf",
    lastModified: "Jun 10, 2024, 10:21 AM",
    etag: `"${base.slice(0, 8)}ad2c3b56f07890a0bbc2d5e4f5678"`,
    storageClass: "STANDARD",
    encryption: "AES-256 (SSE-S3)",
    objectUrl: `https://s3.example.com/${spaceId}/${path}`,
    downloadUrl: `https://s3.example.com/${spaceId}/${path}?x-amz-signature=mocked`,
    versions: [
      { id: "null (current)", sizeBytes: index === 0 ? 4.2 * MB : 2.4 * MB, lastModified: "Jun 10, 2024, 10:21 AM", actionLabel: "Current", current: true },
      { id: "c64c9a...1b7f", sizeBytes: index === 0 ? 4.1 * MB : 2.3 * MB, lastModified: "Jun 9, 2024, 04:18 PM", actionLabel: "Restore" },
    ],
    events: [
      { id: "event-upload", label: "Object uploaded", actor: "alice", timeLabel: "2m ago" },
      { id: "event-share", label: "Object shared", actor: "team", timeLabel: "1h ago" },
    ],
    previewLines: ["Preview is available for compatible text objects.", "This object is represented by mock workspace data."],
  };
}

function buildFiles(spaceId: string, spaceName: string, bucket: Bucket, index: number): PortalWorkspaceFile[] {
  if (isGenomicsSpace(spaceId, spaceName)) {
    return [
      { id: "genomics-01-fastq", name: "01-fastq", kind: "folder", path: "raw-data/2024/03/01-fastq/", updatedLabel: "12 mars 2024, 10:10", ownerLabel: "Workspace", typeLabel: "Dossier" },
      { id: "genomics-02-aligned", name: "02-aligned", kind: "folder", path: "raw-data/2024/03/02-aligned/", updatedLabel: "12 mars 2024, 10:12", ownerLabel: "Workspace", typeLabel: "Dossier" },
      { id: "genomics-03-variants", name: "03-variants", kind: "folder", path: "raw-data/2024/03/03-variants/", updatedLabel: "12 mars 2024, 10:14", ownerLabel: "Workspace", typeLabel: "Dossier" },
      { id: "genomics-sample-001", name: "sample_001.fastq.gz", kind: "file", path: "raw-data/2024/03/sample_001.fastq.gz", sizeBytes: 2.4 * GB, updatedLabel: "12 mars 2024, 10:15", ownerLabel: "Alice", mimeType: "application/gzip", typeLabel: "Fichier" },
      { id: "genomics-sample-002", name: "sample_002.fastq.gz", kind: "file", path: "raw-data/2024/03/sample_002.fastq.gz", sizeBytes: 2.5 * GB, updatedLabel: "12 mars 2024, 10:17", ownerLabel: "Alice", mimeType: "application/gzip", typeLabel: "Fichier" },
      { id: "genomics-sample-003", name: "sample_003.fastq.gz", kind: "file", path: "raw-data/2024/03/sample_003.fastq.gz", sizeBytes: 2.4 * GB, updatedLabel: "12 mars 2024, 10:18", ownerLabel: "Alice", mimeType: "application/gzip", typeLabel: "Fichier" },
      { id: "genomics-readme", name: "README.txt", kind: "file", path: "raw-data/2024/03/README.txt", sizeBytes: 2.1 * 1024, updatedLabel: "12 mars 2024, 10:20", ownerLabel: "Bob", mimeType: "text/plain", typeLabel: "Fichier" },
    ];
  }
  const base = compactName(spaceName);
  const detail = buildObjectDetail(spaceId, spaceName, index);
  return [
    { id: `${base}-folder-docs`, name: "documents", kind: "folder", path: `documents/`, updatedLabel: "Today", ownerLabel: "Workspace", typeLabel: "Folder" },
    { id: `${base}-folder-media`, name: "media", kind: "folder", path: `media/`, updatedLabel: "Yesterday", ownerLabel: "Workspace", typeLabel: "Folder" },
    { id: `${base}-detail`, name: detail.name, kind: "file", path: detail.path, sizeBytes: detail.sizeBytes, updatedLabel: "2h ago", ownerLabel: "alice", mimeType: detail.type, typeLabel: "File" },
    { id: `${base}-dataset`, name: `${base}-dataset.csv`, kind: "file", path: `datasets/${base}-dataset.csv`, sizeBytes: Math.max(32_000, (bucket.object_count ?? 12) * 512), updatedLabel: "1d ago", ownerLabel: "bob", mimeType: "text/csv", typeLabel: "File" },
  ];
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
  const accountName = account?.name ?? "Laurent";
  const regions = ["eu-west-3", "eu-west-3", "eu-west-3", "eu-west-3", "eu-west-3", "eu-west-3", "eu-west-3", "eu-west-3"];
  const spaces = storageSpaces != null
    ? storageSpaces.map((storageSpace, index) => {
        const role = roleFromStorageSpace(storageSpace);
        const bucketName = storageSpace.internal_bucket_name ?? storageSpace.id;
        const name = storageSpace.name || prettyName(storageSpace.id);
        const objectDetail = buildObjectDetail(bucketName, name, index);
        return {
          id: storageSpace.id,
          name,
          internalName: bucketName,
          description: `${name} shared storage`,
          role,
          status: statusForStorageSpace(storageSpace, role),
          access: accessForStorageSpace(storageSpace, index),
          region: storageSpace.region ?? regions[index] ?? "eu-west-3",
          createdLabel: createdLabel(storageSpace.created_at),
          usedBytes: storageSpace.used_bytes ?? null,
          quotaBytes: storageSpace.quota_max_size_bytes ?? null,
          objectCount: storageSpace.object_count ?? null,
          createdAt: storageSpace.created_at ?? null,
          shareCount: role === "Owner" ? 3 + (index % 4) : 1,
          defaultPrefix: isGenomicsSpace(bucketName, name) ? "raw-data/2024/03/" : "",
          files: buildFiles(bucketName, name, {
            name: bucketName,
            creation_date: storageSpace.created_at,
            used_bytes: storageSpace.used_bytes,
            object_count: storageSpace.object_count,
            quota_max_size_bytes: storageSpace.quota_max_size_bytes,
            quota_max_objects: storageSpace.quota_max_objects,
          }, index),
          objectDetail,
        };
      })
    : (() => {
        const sourceBuckets = state && state.buckets.length > 0 ? state.buckets : FALLBACK_BUCKETS;
        const buckets = sourceBuckets.some((bucket) => bucket.name === GENOMICS_BUCKET.name)
          ? sourceBuckets
          : [GENOMICS_BUCKET, ...sourceBuckets];
        return buckets.map((bucket, index) => {
    const role = roleFromState(state, index);
    const name = prettyName(bucket.name);
    const objectDetail = buildObjectDetail(bucket.name, name, index);
    return {
      id: bucket.name,
      name,
      internalName: bucket.name,
      description: `${name} shared storage`,
      role,
      status: statusForBucket(bucket, role),
      access: accessForBucket(bucket, index),
      region: regions[index] ?? "eu-west-3",
      createdLabel: createdLabel(bucket.creation_date),
      usedBytes: bucket.used_bytes ?? null,
      quotaBytes: bucket.quota_max_size_bytes ?? null,
      objectCount: bucket.object_count ?? null,
      createdAt: bucket.creation_date ?? null,
      shareCount: role === "Owner" ? 3 + (index % 4) : 1,
      defaultPrefix: isGenomicsSpace(bucket.name, name) ? "raw-data/2024/03/" : "",
      files: buildFiles(bucket.name, name, bucket, index),
      objectDetail,
    };
        });
      })();

  const fallbackSpace = spaces[0];
  const sharesByMe = spaces.slice(0, 4).map((space, index) => ({
    id: `by-me-${space.id}`,
    spaceId: space.id,
    spaceName: space.name,
    person: ["alice", "bob", "charles", "david"][index] ?? "team",
    access: index === 0 ? "Editor" as const : "Viewer" as const,
    direction: "by_me" as const,
    expiresLabel: index === 2 ? "Jun 30, 2024" : "-",
    activityLabel: ["2h ago", "1d ago", "3h ago", "5h ago"][index] ?? "1d ago",
  }));
  const sharesWithMe = spaces.slice(1, 5).map((space, index) => ({
    id: `with-me-${space.id}`,
    spaceId: space.id,
    spaceName: space.name,
    person: ["alice", "bob", "charles", "david"][index] ?? "owner",
    access: index === 0 ? "Viewer" as const : "Editor" as const,
    direction: "with_me" as const,
    expiresLabel: ["Jun 20, 2024", "Jun 15, 2024", "Jun 30, 2024", "Jun 12, 2024"][index],
    activityLabel: ["2h ago", "1d ago", "3h ago", "5h ago"][index] ?? "1d ago",
  }));
  const publicLinks = fallbackSpace
    ? [
        {
          id: `public-${fallbackSpace.id}`,
          spaceId: fallbackSpace.id,
          spaceName: fallbackSpace.name,
          person: "External review link",
          access: "Viewer" as const,
          direction: "public_link" as const,
          expiresLabel: "Expires in 2 days",
          activityLabel: "Created yesterday",
        },
      ]
    : [];
  const activity: PortalWorkspaceActivityItem[] = spaces.slice(0, 7).map((space, index) => ({
    id: `activity-${space.id}`,
    actor: [userEmail || "alice", "alice", "bob", "charles", "system", "david", "emma"][index] ?? "team",
    action: ["Uploaded", "Upload", "Download", "Download", "Lifecycle Expire", "Delete", "Create Folder"][index] ?? "Updated",
    target: ["image_001.jpg", "image_002.jpg", "report.pdf", "video.mp4", "1,245 objects", "old_backup.zip", "thumbnails/"][index] ?? space.name,
    spaceId: space.id,
    spaceName: space.name,
    timeLabel: ["Jun 10, 10:21", "Jun 10, 10:21", "Jun 10, 09:22", "Jun 9, 18:00", "Jun 8, 16:40", "Jun 8, 11:05", "Jun 8, 10:17"][index] ?? "Jun 8",
    ipAddress: ["192.168.1.10", "192.168.1.10", "192.168.1.23", "192.168.1.45", "-", "192.168.1.31", "192.168.1.12"][index] ?? "-",
  }));
  const transfers: PortalWorkspaceTransfer[] = spaces.slice(0, 5).map((space, index) => ({
    id: `transfer-${space.id}`,
    name: ["big-dataset.zip", "backup-2024.tar", "videos/", "export.csv", "archive.zip"][index] ?? `${compactName(space.name)}-transfer`,
    direction: index <= 2 ? "Upload" : "Download",
    status: (["Uploading", "Uploading", "Completed", "Completed", "Failed"] as const)[index] ?? "Completed",
    progress: [62, 28, 100, 100, 0][index] ?? 100,
    sizeBytes: [8 * GB, 6 * GB, 12 * GB, 180 * MB, 900 * MB][index] ?? 84_000,
    spaceName: space.name,
    startedLabel: ["10:20 AM", "10:16 AM", "09:55 AM", "09:40 AM", "08:30 AM"][index] ?? "Today",
    etaLabel: ["2m 15s", "5m 40s", "Completed", "Completed", "-"][index] ?? "-",
    speedLabel: ["45 MB/s", "32 MB/s", "120 MB/s", "15 MB/s", "-"][index] ?? "-",
  }));
  const usedBytes = usage?.used_bytes ?? state?.used_bytes ?? spaces.reduce((sum, space) => sum + (space.usedBytes ?? 0), 0);
  const usedObjects = usage?.used_objects ?? state?.used_objects ?? spaces.reduce((sum, space) => sum + (space.objectCount ?? 0), 0);
  const quotaBytes = state?.quota_max_size_bytes ?? 20 * TB;
  const usagePercent = percent(usedBytes, quotaBytes);
  const alerts: PortalWorkspaceAlert[] = [
    {
      id: "public-sharing",
      tone: "danger",
      title: "Public access detected",
      description: "public-data is publicly reachable.",
      severityLabel: "Critical",
    },
    {
      id: "link-expiring",
      tone: "warning",
      title: "Shared links expiring",
      description: "3 shared links expire soon.",
      severityLabel: "Warning",
    },
    {
      id: "replication-failed",
      tone: "warning",
      title: "Transfer retry needed",
      description: "1 recent transfer failed.",
      severityLabel: "Warning",
    },
  ];
  if (usagePercent != null && usagePercent >= 80) {
    alerts.unshift({
      id: "quota-near",
      tone: usagePercent >= 95 ? "danger" : "warning",
      title: "Quota is getting close",
      description: `${Math.round(usagePercent)}% of workspace storage is used.`,
      severityLabel: usagePercent >= 95 ? "Critical" : "Warning",
    });
  }
  const usageTrend = ["May 10", "May 17", "May 24", "May 31", "Jun 7", "Jun 10"].map((label, index) => ({
    label,
    value: Math.max(1, usedBytes * (0.48 + index * 0.09)),
  }));

  return {
    accountName,
    userEmail,
    spaces,
    sharesWithMe,
    sharesByMe,
    publicLinks,
    activity,
    transfers,
    alerts,
    usageTrend,
    adminUsers: [
      { username: "alice", groups: "research", status: "Active", mfa: "Enabled", lastActive: "2m ago" },
      { username: "bob", groups: "devops", status: "Active", mfa: "Enabled", lastActive: "15m ago" },
      { username: "charles", groups: "analysts", status: "Active", mfa: "Disabled", lastActive: "1h ago" },
      { username: "david", groups: "research", status: "Active", mfa: "Enabled", lastActive: "3h ago" },
      { username: "emma", groups: "interns", status: "Inactive", mfa: "Disabled", lastActive: "-" },
      { username: "frank", groups: "devops", status: "Active", mfa: "Enabled", lastActive: "1d ago" },
      { username: "grace", groups: "guests", status: "Active", mfa: "Disabled", lastActive: "2d ago" },
    ],
    groups: [
      { name: "research", users: 4, policies: 3, description: "Research team members" },
      { name: "devops", users: 3, policies: 5, description: "DevOps team" },
      { name: "analysts", users: 5, policies: 2, description: "Data analysts" },
      { name: "interns", users: 6, policies: 1, description: "Intern users" },
      { name: "gamma", users: 12, policies: 1, description: "Temporary guest access" },
      { name: "support", users: 2, policies: 4, description: "Support team" },
    ],
    policies: [
      { name: "read-only", type: "Managed", usedBy: "3 groups, 12 users", lastModified: "May 10, 2024" },
      { name: "read-write", type: "Managed", usedBy: "2 groups, 6 users", lastModified: "May 8, 2024" },
      { name: "s3-full-access", type: "Managed", usedBy: "1 group, 2 users", lastModified: "Apr 20, 2024" },
      { name: "replication-policy", type: "Managed", usedBy: "2 roles", lastModified: "Apr 11, 2024" },
      { name: "custom-datasets", type: "Custom", usedBy: "1 group", lastModified: "May 10, 2024" },
      { name: "readonly-logs", type: "Custom", usedBy: "1 user", lastModified: "May 15, 2024" },
    ],
    accessKeys: [
      { name: "AKIA********34LF", owner: "alice", status: "Active", created: "May 1, 2024", lastUsed: "2m ago" },
      { name: "AKIA********9K2P", owner: "bob", status: "Active", created: "May 3, 2024", lastUsed: "18m ago" },
      { name: "AKIA********M71A", owner: "charles", status: "Inactive", created: "Apr 21, 2024", lastUsed: "7d ago" },
      { name: "AKIA********P92Q", owner: "system", status: "Active", created: "Apr 12, 2024", lastUsed: "1h ago" },
    ],
    usedBytes,
    usedObjects,
    quotaBytes,
    quotaObjects: state?.quota_max_objects ?? 30_000_000,
    requestCount: 12_600_000,
    dataInBytes: 4.2 * TB,
    dataOutBytes: 2.1 * TB,
  };
}
