/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useEffect, useMemo, useState } from "react";
import PageHeader from "../../components/PageHeader";
import TableEmptyState from "../../components/TableEmptyState";

type TreeNode = {
  id: string;
  name: string;
  path: string;
  type: "bucket" | "folder";
  children?: TreeNode[];
};

type BrowserItem = {
  id: string;
  name: string;
  type: "folder" | "file";
  size: string;
  modified: string;
  owner: string;
  storageClass?: string;
};

type OperationItem = {
  id: string;
  label: string;
  path: string;
  progress: number;
  status: "uploading" | "deleting" | "copying";
};

type ObjectVersion = {
  id: string;
  size: string;
  modified: string;
  current?: boolean;
};

type ObjectDetail = {
  contentType: string;
  etag: string;
  checksum: string;
  encryption: string;
  tags: string[];
  retention: string;
  versions?: ObjectVersion[];
};

type ActivityItem = {
  id: string;
  action: string;
  path: string;
  actor: string;
  when: string;
};

const treeData: TreeNode[] = [
  {
    id: "media-prod",
    name: "media-prod",
    path: "media-prod",
    type: "bucket",
    children: [
      {
        id: "media-prod/assets",
        name: "assets",
        path: "media-prod/assets",
        type: "folder",
        children: [
          {
            id: "media-prod/assets/2024",
            name: "2024",
            path: "media-prod/assets/2024",
            type: "folder",
          },
        ],
      },
      {
        id: "media-prod/backups",
        name: "backups",
        path: "media-prod/backups",
        type: "folder",
      },
    ],
  },
  {
    id: "logs",
    name: "logs",
    path: "logs",
    type: "bucket",
    children: [
      {
        id: "logs/ingest",
        name: "ingest",
        path: "logs/ingest",
        type: "folder",
      },
      {
        id: "logs/archive",
        name: "archive",
        path: "logs/archive",
        type: "folder",
      },
    ],
  },
  {
    id: "analytics",
    name: "analytics",
    path: "analytics",
    type: "bucket",
    children: [
      {
        id: "analytics/datasets",
        name: "datasets",
        path: "analytics/datasets",
        type: "folder",
      },
    ],
  },
];

const contentIndex: Record<string, BrowserItem[]> = {
  "media-prod": [
    {
      id: "media-prod/assets",
      name: "assets",
      type: "folder",
      size: "-",
      modified: "2024-05-12 09:44",
      owner: "media-team",
    },
    {
      id: "media-prod/backups",
      name: "backups",
      type: "folder",
      size: "-",
      modified: "2024-05-10 07:15",
      owner: "media-team",
    },
    {
      id: "media-prod/logo.svg",
      name: "logo.svg",
      type: "file",
      size: "214 KB",
      modified: "2024-05-11 12:06",
      owner: "design",
      storageClass: "STANDARD",
    },
    {
      id: "media-prod/banner.png",
      name: "banner.png",
      type: "file",
      size: "1.3 MB",
      modified: "2024-05-09 18:22",
      owner: "design",
      storageClass: "STANDARD",
    },
  ],
  "media-prod/assets": [
    {
      id: "media-prod/assets/2024",
      name: "2024",
      type: "folder",
      size: "-",
      modified: "2024-05-01 08:00",
      owner: "media-team",
    },
    {
      id: "media-prod/assets/hero.mp4",
      name: "hero.mp4",
      type: "file",
      size: "84 MB",
      modified: "2024-05-13 10:34",
      owner: "marketing",
      storageClass: "STANDARD",
    },
    {
      id: "media-prod/assets/thumbs.zip",
      name: "thumbs.zip",
      type: "file",
      size: "12 MB",
      modified: "2024-05-12 14:01",
      owner: "media-team",
      storageClass: "STANDARD_IA",
    },
  ],
  "media-prod/assets/2024": [
    {
      id: "media-prod/assets/2024/launch.mov",
      name: "launch.mov",
      type: "file",
      size: "1.2 GB",
      modified: "2024-05-04 15:50",
      owner: "studio",
      storageClass: "STANDARD",
    },
    {
      id: "media-prod/assets/2024/teaser.mp4",
      name: "teaser.mp4",
      type: "file",
      size: "640 MB",
      modified: "2024-05-03 11:20",
      owner: "studio",
      storageClass: "STANDARD",
    },
  ],
  "media-prod/backups": [
    {
      id: "media-prod/backups/2024-05-14.tar.gz",
      name: "2024-05-14.tar.gz",
      type: "file",
      size: "3.8 GB",
      modified: "2024-05-14 01:12",
      owner: "ops",
      storageClass: "GLACIER",
    },
    {
      id: "media-prod/backups/2024-05-13.tar.gz",
      name: "2024-05-13.tar.gz",
      type: "file",
      size: "3.7 GB",
      modified: "2024-05-13 01:08",
      owner: "ops",
      storageClass: "GLACIER",
    },
  ],
  "logs": [
    {
      id: "logs/ingest",
      name: "ingest",
      type: "folder",
      size: "-",
      modified: "2024-05-14 09:21",
      owner: "platform",
    },
    {
      id: "logs/archive",
      name: "archive",
      type: "folder",
      size: "-",
      modified: "2024-05-10 19:40",
      owner: "platform",
    },
    {
      id: "logs/router.log",
      name: "router.log",
      type: "file",
      size: "48 MB",
      modified: "2024-05-14 09:58",
      owner: "platform",
      storageClass: "STANDARD",
    },
  ],
  "logs/ingest": [
    {
      id: "logs/ingest/2024-05-14.log",
      name: "2024-05-14.log",
      type: "file",
      size: "1.4 GB",
      modified: "2024-05-14 09:58",
      owner: "platform",
      storageClass: "STANDARD_IA",
    },
    {
      id: "logs/ingest/2024-05-13.log",
      name: "2024-05-13.log",
      type: "file",
      size: "1.1 GB",
      modified: "2024-05-13 23:12",
      owner: "platform",
      storageClass: "STANDARD_IA",
    },
  ],
  "logs/archive": [
    {
      id: "logs/archive/2024-04-30.log.gz",
      name: "2024-04-30.log.gz",
      type: "file",
      size: "512 MB",
      modified: "2024-05-01 00:10",
      owner: "platform",
      storageClass: "GLACIER",
    },
  ],
  "analytics": [
    {
      id: "analytics/datasets",
      name: "datasets",
      type: "folder",
      size: "-",
      modified: "2024-05-08 17:22",
      owner: "data-team",
    },
    {
      id: "analytics/warehouse.parquet",
      name: "warehouse.parquet",
      type: "file",
      size: "8.4 GB",
      modified: "2024-05-08 17:30",
      owner: "data-team",
      storageClass: "STANDARD",
    },
  ],
  "analytics/datasets": [
    {
      id: "analytics/datasets/facts-2024.parquet",
      name: "facts-2024.parquet",
      type: "file",
      size: "2.1 GB",
      modified: "2024-05-08 17:31",
      owner: "data-team",
      storageClass: "STANDARD",
    },
    {
      id: "analytics/datasets/segments.csv",
      name: "segments.csv",
      type: "file",
      size: "740 MB",
      modified: "2024-05-08 17:12",
      owner: "data-team",
      storageClass: "STANDARD_IA",
    },
  ],
};

const operations: OperationItem[] = [
  {
    id: "op-upload-1",
    label: "Uploading",
    path: "logs/ingest/2024-05-14.log",
    progress: 72,
    status: "uploading",
  },
  {
    id: "op-copy-1",
    label: "Copying",
    path: "media-prod/assets/hero.mp4",
    progress: 38,
    status: "copying",
  },
  {
    id: "op-delete-1",
    label: "Deleting",
    path: "media-prod/backups/2024-05-10.tar.gz",
    progress: 54,
    status: "deleting",
  },
];

const objectDetails: Record<string, ObjectDetail> = {
  "media-prod/logo.svg": {
    contentType: "image/svg+xml",
    etag: "b4d9f9c1a7f3c2",
    checksum: "SHA256 2f8c9a7a",
    encryption: "SSE-S3",
    retention: "None",
    tags: ["brand", "logo", "svg"],
    versions: [
      { id: "v3", size: "214 KB", modified: "2024-05-11 12:06", current: true },
      { id: "v2", size: "210 KB", modified: "2024-03-02 10:22" },
    ],
  },
  "media-prod/assets/hero.mp4": {
    contentType: "video/mp4",
    etag: "0aa1bd980f45",
    checksum: "SHA256 8b1c3f4d",
    encryption: "SSE-S3",
    retention: "30d",
    tags: ["hero", "launch", "2024"],
    versions: [
      { id: "v5", size: "84 MB", modified: "2024-05-13 10:34", current: true },
      { id: "v4", size: "82 MB", modified: "2024-05-12 09:10" },
    ],
  },
  "media-prod/backups/2024-05-14.tar.gz": {
    contentType: "application/gzip",
    etag: "a13d9c22",
    checksum: "SHA256 91b2c301",
    encryption: "SSE-S3",
    retention: "90d",
    tags: ["backup", "daily"],
  },
  "logs/router.log": {
    contentType: "text/plain",
    etag: "d19f73aa",
    checksum: "SHA256 19f2a1c2",
    encryption: "SSE-S3",
    retention: "14d",
    tags: ["router", "edge"],
  },
  "analytics/warehouse.parquet": {
    contentType: "application/parquet",
    etag: "ca91b01f",
    checksum: "SHA256 8f9ad3c1",
    encryption: "SSE-KMS",
    retention: "365d",
    tags: ["warehouse", "prod"],
  },
};

const activityLog: ActivityItem[] = [
  {
    id: "activity-1",
    action: "Uploaded",
    path: "media-prod/assets/hero.mp4",
    actor: "marketing",
    when: "8m ago",
  },
  {
    id: "activity-2",
    action: "Deleted",
    path: "media-prod/backups/2024-05-10.tar.gz",
    actor: "ops",
    when: "2h ago",
  },
  {
    id: "activity-3",
    action: "Tagged",
    path: "analytics/warehouse.parquet",
    actor: "data-team",
    when: "Yesterday",
  },
];

const iconButtonClasses =
  "inline-flex h-8 w-8 items-center justify-center rounded-md border border-slate-200 text-slate-600 transition hover:border-primary hover:text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:opacity-40 dark:border-slate-700 dark:text-slate-200 dark:hover:border-primary-500 dark:hover:text-primary-200";
const iconButtonDangerClasses =
  "inline-flex h-8 w-8 items-center justify-center rounded-md border border-rose-200 text-rose-600 transition hover:bg-rose-50 hover:text-rose-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose-500 disabled:opacity-40 dark:border-rose-500/50 dark:text-rose-200 dark:hover:bg-rose-900/30 dark:hover:text-rose-100";
const bulkActionClasses =
  "inline-flex items-center gap-2 rounded-full border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:border-primary hover:text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:opacity-50 dark:border-slate-700 dark:text-slate-100 dark:hover:border-primary-500 dark:hover:text-primary-100";
const bulkDangerClasses =
  "inline-flex items-center gap-2 rounded-full border border-rose-200 px-3 py-1.5 text-xs font-semibold text-rose-700 transition hover:bg-rose-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose-500 disabled:opacity-50 dark:border-rose-500/50 dark:text-rose-200 dark:hover:bg-rose-900/30";
const toolbarButtonClasses =
  "inline-flex items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 shadow-sm transition hover:border-primary hover:text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:border-primary-500 dark:hover:text-primary-100";
const toolbarPrimaryClasses =
  "inline-flex items-center gap-2 rounded-md bg-primary px-3 py-2 text-xs font-semibold text-white shadow-sm transition hover:bg-primary-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary";
const filterChipClasses =
  "inline-flex items-center gap-2 rounded-full border border-slate-200 px-3 py-1 text-xs font-semibold text-slate-600 transition hover:border-primary hover:text-primary dark:border-slate-700 dark:text-slate-200 dark:hover:border-primary-500 dark:hover:text-primary-100";
const filterChipActiveClasses =
  "border-primary-200 bg-primary-100 text-primary-800 dark:border-primary-600 dark:bg-primary-900/30 dark:text-primary-100";
const viewToggleBaseClasses =
  "inline-flex h-8 w-8 items-center justify-center rounded-md text-slate-500 transition hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-100";
const viewToggleActiveClasses = "bg-primary-100 text-primary-700 dark:bg-primary-900/40 dark:text-primary-100";

const storageClassChipClasses: Record<string, string> = {
  STANDARD: "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/40 dark:bg-emerald-900/20 dark:text-emerald-200",
  STANDARD_IA: "border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-500/40 dark:bg-sky-900/20 dark:text-sky-200",
  GLACIER: "border-indigo-200 bg-indigo-50 text-indigo-700 dark:border-indigo-500/40 dark:bg-indigo-900/20 dark:text-indigo-200",
};

const sizeMultipliers: Record<string, number> = {
  B: 1,
  KB: 1024,
  MB: 1024 ** 2,
  GB: 1024 ** 3,
  TB: 1024 ** 4,
  PB: 1024 ** 5,
};

const parseSizeToBytes = (size: string): number | null => {
  if (!size || size === "-") return null;
  const match = size.trim().match(/^([\d.]+)\s*([A-Za-z]+)$/);
  if (!match) return null;
  const value = Number.parseFloat(match[1]);
  if (Number.isNaN(value)) return null;
  const unit = match[2].toUpperCase();
  const multiplier = sizeMultipliers[unit];
  if (!multiplier) return null;
  return value * multiplier;
};

const formatBytes = (bytes?: number | null): string => {
  if (bytes === undefined || bytes === null) return "-";
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB", "PB"];
  let value = bytes;
  let idx = 0;
  while (value >= 1024 && idx < units.length - 1) {
    value /= 1024;
    idx += 1;
  }
  const decimals = value >= 10 || idx === 0 ? 0 : 1;
  return `${value.toFixed(decimals)} ${units[idx]}`;
};

const getExtension = (name: string) => {
  const idx = name.lastIndexOf(".");
  if (idx === -1) return "";
  return name.slice(idx + 1).toLowerCase();
};

const isImageFile = (name: string) => {
  const ext = getExtension(name);
  return ["png", "jpg", "jpeg", "gif", "svg", "webp"].includes(ext);
};

const previewLabelForItem = (item: BrowserItem) => {
  if (item.type === "folder") return "FOLDER";
  const ext = getExtension(item.name);
  if (!ext) return "FILE";
  return ext.toUpperCase();
};

const FolderIcon = ({ className = "h-4 w-4" }: { className?: string }) => (
  <svg viewBox="0 0 20 20" className={className} fill="none" aria-hidden="true">
    <path
      d="M2.5 6.5a2 2 0 0 1 2-2h3l1.6 1.6a2 2 0 0 0 1.4.6H15.5a2 2 0 0 1 2 2v5.6a2 2 0 0 1-2 2h-11a2 2 0 0 1-2-2v-8.8Z"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinejoin="round"
    />
  </svg>
);

const FileIcon = ({ className = "h-4 w-4" }: { className?: string }) => (
  <svg viewBox="0 0 20 20" className={className} fill="none" aria-hidden="true">
    <path
      d="M5 3.5h5.6L15.5 8v8.5a1.5 1.5 0 0 1-1.5 1.5H5A1.5 1.5 0 0 1 3.5 16.5v-11A2 2 0 0 1 5.5 3.5Z"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinejoin="round"
    />
    <path d="M10.6 3.5V7a1 1 0 0 0 1 1h3.4" stroke="currentColor" strokeWidth="1.4" />
  </svg>
);

const BucketIcon = ({ className = "h-4 w-4" }: { className?: string }) => (
  <svg viewBox="0 0 20 20" className={className} fill="none" aria-hidden="true">
    <ellipse cx="10" cy="5.5" rx="6.5" ry="2.8" stroke="currentColor" strokeWidth="1.4" />
    <path
      d="M3.5 5.5v6.5c0 1.7 2.9 3 6.5 3s6.5-1.3 6.5-3V5.5"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinejoin="round"
    />
  </svg>
);

const OpenIcon = ({ className = "h-4 w-4" }: { className?: string }) => (
  <svg viewBox="0 0 20 20" className={className} fill="none" aria-hidden="true">
    <path d="M7 5h8v8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    <path d="m7 13 8-8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
  </svg>
);

const EyeIcon = ({ className = "h-4 w-4" }: { className?: string }) => (
  <svg viewBox="0 0 20 20" className={className} fill="none" aria-hidden="true">
    <path
      d="M2.5 10s2.8-4.5 7.5-4.5S17.5 10 17.5 10s-2.8 4.5-7.5 4.5S2.5 10 2.5 10Z"
      stroke="currentColor"
      strokeWidth="1.4"
    />
    <circle cx="10" cy="10" r="2.2" stroke="currentColor" strokeWidth="1.4" />
  </svg>
);

const DownloadIcon = ({ className = "h-4 w-4" }: { className?: string }) => (
  <svg viewBox="0 0 20 20" className={className} fill="none" aria-hidden="true">
    <path d="M10 3.5v8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    <path d="m6.5 9.5 3.5 3.5 3.5-3.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    <path d="M4 15.5h12" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
  </svg>
);

const CopyIcon = ({ className = "h-4 w-4" }: { className?: string }) => (
  <svg viewBox="0 0 20 20" className={className} fill="none" aria-hidden="true">
    <rect x="7" y="7" width="9" height="9" rx="1.6" stroke="currentColor" strokeWidth="1.4" />
    <rect x="4" y="4" width="9" height="9" rx="1.6" stroke="currentColor" strokeWidth="1.4" />
  </svg>
);

const TrashIcon = ({ className = "h-4 w-4" }: { className?: string }) => (
  <svg viewBox="0 0 20 20" className={className} fill="none" aria-hidden="true">
    <path d="M4.5 6.5h11" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    <path d="M8 6.5V5a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v1.5" stroke="currentColor" strokeWidth="1.4" />
    <path d="M6.5 6.5l.6 8a1 1 0 0 0 1 .9h3.8a1 1 0 0 0 1-.9l.6-8" stroke="currentColor" strokeWidth="1.4" />
  </svg>
);

const MoreIcon = ({ className = "h-4 w-4" }: { className?: string }) => (
  <svg viewBox="0 0 20 20" className={className} fill="currentColor" aria-hidden="true">
    <circle cx="6" cy="10" r="1.4" />
    <circle cx="10" cy="10" r="1.4" />
    <circle cx="14" cy="10" r="1.4" />
  </svg>
);

const SearchIcon = ({ className = "h-4 w-4" }: { className?: string }) => (
  <svg viewBox="0 0 20 20" className={className} fill="none" aria-hidden="true">
    <circle cx="9" cy="9" r="5.5" stroke="currentColor" strokeWidth="1.4" />
    <path d="M13 13l3 3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
  </svg>
);

const ListIcon = ({ className = "h-4 w-4" }: { className?: string }) => (
  <svg viewBox="0 0 20 20" className={className} fill="none" aria-hidden="true">
    <path d="M4 6h12" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    <path d="M4 10h12" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    <path d="M4 14h12" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
  </svg>
);

const GridIcon = ({ className = "h-4 w-4" }: { className?: string }) => (
  <svg viewBox="0 0 20 20" className={className} fill="none" aria-hidden="true">
    <rect x="3.5" y="3.5" width="5.5" height="5.5" rx="1" stroke="currentColor" strokeWidth="1.4" />
    <rect x="11" y="3.5" width="5.5" height="5.5" rx="1" stroke="currentColor" strokeWidth="1.4" />
    <rect x="3.5" y="11" width="5.5" height="5.5" rx="1" stroke="currentColor" strokeWidth="1.4" />
    <rect x="11" y="11" width="5.5" height="5.5" rx="1" stroke="currentColor" strokeWidth="1.4" />
  </svg>
);

export default function BrowserPage() {
  const [selectedPath, setSelectedPath] = useState(treeData[0]?.path ?? "");
  const [filter, setFilter] = useState("");
  const [activeItem, setActiveItem] = useState<BrowserItem | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [viewMode, setViewMode] = useState<"list" | "grid">("list");
  const [typeFilter, setTypeFilter] = useState<"all" | "file" | "folder">("all");
  const [storageFilter, setStorageFilter] = useState<string>("all");
  const [sortId, setSortId] = useState("name-asc");

  const handleSelectPath = (path: string) => {
    setSelectedPath(path);
    setActiveItem(null);
  };

  const items = contentIndex[selectedPath] ?? [];
  const sortOptions = [
    { id: "name-asc", label: "Name (A-Z)", key: "name", direction: "asc" as const },
    { id: "name-desc", label: "Name (Z-A)", key: "name", direction: "desc" as const },
    { id: "modified-desc", label: "Last modified (newest)", key: "modified", direction: "desc" as const },
    { id: "modified-asc", label: "Last modified (oldest)", key: "modified", direction: "asc" as const },
    { id: "size-desc", label: "Size (largest)", key: "size", direction: "desc" as const },
    { id: "size-asc", label: "Size (smallest)", key: "size", direction: "asc" as const },
  ];
  const activeSort = sortOptions.find((option) => option.id === sortId) ?? sortOptions[0];

  const filteredItems = useMemo(() => {
    const q = filter.trim().toLowerCase();
    let next = q ? items.filter((item) => item.name.toLowerCase().includes(q)) : items;
    if (typeFilter !== "all") {
      next = next.filter((item) => item.type === typeFilter);
    }
    if (storageFilter !== "all") {
      next = next.filter((item) => item.type === "folder" || item.storageClass === storageFilter);
    }
    return [...next].sort((a, b) => {
      if (a.type !== b.type) return a.type === "folder" ? -1 : 1;
      if (activeSort.key === "size") {
        const aSize = parseSizeToBytes(a.size) ?? 0;
        const bSize = parseSizeToBytes(b.size) ?? 0;
        return activeSort.direction === "asc" ? aSize - bSize : bSize - aSize;
      }
      if (activeSort.key === "modified") {
        const result = a.modified.localeCompare(b.modified);
        return activeSort.direction === "asc" ? result : -result;
      }
      const result = a.name.localeCompare(b.name);
      return activeSort.direction === "asc" ? result : -result;
    });
  }, [activeSort.direction, activeSort.key, filter, items, storageFilter, typeFilter]);

  const pathParts = selectedPath.split("/").filter(Boolean);
  const bucketName = pathParts[0] ?? "";
  const prefixParts = pathParts.slice(1);
  const bucketOptions = useMemo(
    () => treeData.map((bucket) => ({ name: bucket.name, path: bucket.path })),
    []
  );

  const breadcrumbs = useMemo(() => {
    if (!bucketName) return [];
    let current = bucketName;
    return prefixParts.map((part) => {
      current = `${current}/${part}`;
      return { label: part, path: current };
    });
  }, [bucketName, prefixParts]);

  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const allSelected = filteredItems.length > 0 && filteredItems.every((item) => selectedSet.has(item.id));
  const selectedCount = selectedIds.length;
  const selectedBytes = useMemo(() => {
    return selectedIds.reduce((sum, id) => {
      const item = items.find((entry) => entry.id === id);
      if (!item) return sum;
      const bytes = parseSizeToBytes(item.size) ?? 0;
      return sum + bytes;
    }, 0);
  }, [items, selectedIds]);

  const availableStorageClasses = useMemo(() => {
    const classes = new Set<string>();
    items.forEach((item) => {
      if (item.storageClass) {
        classes.add(item.storageClass);
      }
    });
    return Array.from(classes);
  }, [items]);

  const pathStats = useMemo(() => {
    let totalBytes = 0;
    let files = 0;
    let folders = 0;
    const storageCounts: Record<string, number> = {};
    items.forEach((item) => {
      if (item.type === "folder") {
        folders += 1;
        return;
      }
      files += 1;
      totalBytes += parseSizeToBytes(item.size) ?? 0;
      const storage = item.storageClass ?? "STANDARD";
      storageCounts[storage] = (storageCounts[storage] ?? 0) + 1;
    });
    return { totalBytes, files, folders, storageCounts };
  }, [items]);

  const inspectedItem = useMemo(() => {
    if (activeItem && items.some((entry) => entry.id === activeItem.id)) {
      return activeItem;
    }
    if (selectedIds.length === 1) {
      return items.find((entry) => entry.id === selectedIds[0]) ?? null;
    }
    return null;
  }, [activeItem, items, selectedIds]);

  const inspectedDetails = inspectedItem ? objectDetails[inspectedItem.id] : null;
  const inspectedPath = inspectedItem ? `${selectedPath}/${inspectedItem.name}` : selectedPath;

  const handleOpenItem = (item: BrowserItem) => {
    if (item.type !== "folder") return;
    const nextPath = `${selectedPath}/${item.name}`;
    if (contentIndex[nextPath]) {
      handleSelectPath(nextPath);
    }
  };

  useEffect(() => {
    setSelectedIds([]);
    setActiveItem(null);
  }, [selectedPath]);

  useEffect(() => {
    setSelectedIds((prev) => prev.filter((id) => items.some((item) => item.id === id)));
    if (activeItem && !items.some((item) => item.id === activeItem.id)) {
      setActiveItem(null);
    }
  }, [activeItem, items]);

  useEffect(() => {
    if (storageFilter !== "all" && !availableStorageClasses.includes(storageFilter)) {
      setStorageFilter("all");
    }
  }, [availableStorageClasses, storageFilter]);

  const toggleSelection = (id: string) => {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((itemId) => itemId !== id) : [...prev, id]));
  };

  const toggleAllSelection = () => {
    if (allSelected) {
      setSelectedIds([]);
      return;
    }
    setSelectedIds(filteredItems.map((item) => item.id));
  };

  const handleBucketChange = (value: string) => {
    const match = bucketOptions.find((bucket) => bucket.name === value);
    if (match) {
      handleSelectPath(match.path);
    }
  };

  const statusLabel = (status: OperationItem["status"]) => {
    if (status === "uploading") return "Uploading";
    if (status === "copying") return "Copying";
    return "Deleting";
  };

  const statusClasses = (status: OperationItem["status"]) => {
    if (status === "uploading") return "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-200";
    if (status === "copying") return "bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-200";
    return "bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-200";
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Browser"
        description="Browse buckets, prefixes, and objects for the current account."
        breadcrumbs={[{ label: "Manager" }, { label: "Browser" }]}
        inlineContent={
          bucketName ? (
            <span className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-600 shadow-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200">
              <BucketIcon className="h-3.5 w-3.5" />
              {bucketName}
            </span>
          ) : null
        }
      />

      <div className="rounded-2xl border border-slate-200/80 bg-white/90 shadow-sm dark:border-slate-800 dark:bg-slate-900/70">
        <div className="flex h-full flex-col">
            <div className="border-b border-slate-200 px-4 py-4 dark:border-slate-800">
              <div className="space-y-4">
                <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
                  <div className="space-y-2">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Location</p>
                    <div className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-900">
                      <BucketIcon className="h-4 w-4 text-slate-500 dark:text-slate-300" />
                      <select
                        className="bg-transparent text-xs font-semibold text-slate-700 focus:outline-none dark:text-slate-200"
                        value={bucketName}
                        onChange={(event) => handleBucketChange(event.target.value)}
                      >
                        {bucketOptions.map((bucket) => (
                          <option key={bucket.path} value={bucket.name}>
                            {bucket.name}
                          </option>
                        ))}
                      </select>
                      <div className="flex flex-wrap items-center gap-1 text-xs font-semibold text-slate-500 dark:text-slate-400">
                        {breadcrumbs.length === 0 && <span className="text-slate-400">(root)</span>}
                        {breadcrumbs.map((crumb, index) => (
                          <span key={crumb.path} className="flex items-center gap-1">
                            <span className="text-slate-300">/</span>
                            <button
                              type="button"
                              onClick={() => handleSelectPath(crumb.path)}
                              className="rounded-md px-1.5 py-0.5 text-slate-600 transition hover:bg-slate-100 hover:text-slate-800 dark:text-slate-300 dark:hover:bg-slate-800"
                            >
                              {crumb.label}
                            </button>
                          </span>
                        ))}
                      </div>
                    </div>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      {filteredItems.length} item(s) in this prefix. {pathStats.files} files, {pathStats.folders} folders.
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <button type="button" className={toolbarButtonClasses}>
                      Refresh
                    </button>
                    <button type="button" className={toolbarButtonClasses}>
                      New folder
                    </button>
                    <button type="button" className={toolbarPrimaryClasses}>
                      Upload
                    </button>
                  </div>
                </div>

                <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                  <div className="flex flex-1 flex-wrap items-center gap-2">
                    <div className="relative w-full sm:max-w-xs">
                      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">
                        <SearchIcon />
                      </span>
                      <input
                        type="text"
                        value={filter}
                        onChange={(event) => setFilter(event.target.value)}
                        placeholder="Filter objects"
                        className="w-full rounded-md border border-slate-200 bg-white py-2 pl-9 pr-3 text-sm text-slate-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                      />
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      {[
                        { id: "all", label: "All" },
                        { id: "file", label: "Files" },
                        { id: "folder", label: "Folders" },
                      ].map((option) => (
                        <button
                          key={option.id}
                          type="button"
                          onClick={() => setTypeFilter(option.id as "all" | "file" | "folder")}
                          className={`${filterChipClasses} ${typeFilter === option.id ? filterChipActiveClasses : ""}`}
                        >
                          {option.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    {availableStorageClasses.length > 0 && (
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          onClick={() => setStorageFilter("all")}
                          className={`${filterChipClasses} ${storageFilter === "all" ? filterChipActiveClasses : ""}`}
                        >
                          Storage: All
                        </button>
                        {availableStorageClasses.map((storage) => (
                          <button
                            key={storage}
                            type="button"
                            onClick={() => setStorageFilter(storage)}
                            className={`${filterChipClasses} ${storageFilter === storage ? filterChipActiveClasses : ""}`}
                          >
                            {storage}
                          </button>
                        ))}
                      </div>
                    )}
                    <div className="rounded-md border border-slate-200 bg-white px-2 py-1 text-xs font-semibold text-slate-600 shadow-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200">
                      <select
                        className="bg-transparent text-xs font-semibold text-slate-700 focus:outline-none dark:text-slate-200"
                        value={sortId}
                        onChange={(event) => setSortId(event.target.value)}
                      >
                        {sortOptions.map((option) => (
                          <option key={option.id} value={option.id}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="flex items-center gap-1 rounded-md border border-slate-200 bg-white px-1 py-1 shadow-sm dark:border-slate-700 dark:bg-slate-900">
                      <button
                        type="button"
                        onClick={() => setViewMode("list")}
                        className={`${viewToggleBaseClasses} ${viewMode === "list" ? viewToggleActiveClasses : ""}`}
                        aria-label="List view"
                      >
                        <ListIcon />
                      </button>
                      <button
                        type="button"
                        onClick={() => setViewMode("grid")}
                        className={`${viewToggleBaseClasses} ${viewMode === "grid" ? viewToggleActiveClasses : ""}`}
                        aria-label="Grid view"
                      >
                        <GridIcon />
                      </button>
                    </div>
                  </div>
                </div>

                {selectedCount > 0 && (
                  <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600 dark:border-slate-700 dark:bg-slate-900/40 dark:text-slate-300">
                    <div className="flex items-center gap-2">
                      <span className="rounded-full bg-slate-200 px-2 py-0.5 text-[11px] font-semibold text-slate-700 dark:bg-slate-800 dark:text-slate-200">
                        {selectedCount} selected
                      </span>
                      <span className="text-xs text-slate-500 dark:text-slate-400">{formatBytes(selectedBytes)}</span>
                      <button
                        type="button"
                        onClick={() => setSelectedIds([])}
                        className="text-xs font-semibold text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
                      >
                        Clear
                      </button>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <button type="button" className={bulkActionClasses} disabled={selectedCount === 0}>
                        <DownloadIcon className="h-3.5 w-3.5" />
                        Download
                      </button>
                      <button type="button" className={bulkActionClasses} disabled={selectedCount === 0}>
                        <CopyIcon className="h-3.5 w-3.5" />
                        Copy
                      </button>
                      <button type="button" className={bulkDangerClasses} disabled={selectedCount === 0}>
                        <TrashIcon className="h-3.5 w-3.5" />
                        Delete
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div className="flex-1 p-4">
              <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
                <div className="rounded-xl border border-slate-200 dark:border-slate-800">
                  {viewMode === "list" ? (
                    <div className="overflow-x-auto">
                      <table className="manager-table min-w-full divide-y divide-slate-200 dark:divide-slate-800">
                        <thead className="bg-slate-50 dark:bg-slate-900/50">
                          <tr>
                            <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                              <input
                                type="checkbox"
                                checked={allSelected}
                                onChange={toggleAllSelection}
                                aria-label="Select all"
                                className="h-4 w-4 rounded border-slate-300 text-primary focus:ring-primary dark:border-slate-600"
                              />
                            </th>
                            <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                              Name
                            </th>
                            <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                              Size
                            </th>
                            <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                              Modified
                            </th>
                            <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                              Owner
                            </th>
                            <th className="px-6 py-3 text-right text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                              Actions
                            </th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                          {filteredItems.length === 0 && (
                            <TableEmptyState colSpan={6} message="No objects found for this path." />
                          )}
                          {filteredItems.map((item) => (
                            <tr
                              key={item.id}
                              className={`hover:bg-slate-50 dark:hover:bg-slate-800/40 ${
                                selectedSet.has(item.id) ? "bg-primary-50/50 dark:bg-primary-900/20" : ""
                              }`}
                            >
                              <td className="px-6 py-4">
                                <input
                                  type="checkbox"
                                  checked={selectedSet.has(item.id)}
                                  onChange={() => toggleSelection(item.id)}
                                  aria-label={`Select ${item.name}`}
                                  className="h-4 w-4 rounded border-slate-300 text-primary focus:ring-primary dark:border-slate-600"
                                />
                              </td>
                              <td className="manager-table-cell px-6 py-4 text-sm text-slate-700 dark:text-slate-200">
                                <div className="flex items-center gap-3">
                                  <span className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-200">
                                    {item.type === "folder" ? <FolderIcon /> : <FileIcon />}
                                  </span>
                                  <div>
                                    <button
                                      type="button"
                                      onClick={() => (item.type === "folder" ? handleOpenItem(item) : setActiveItem(item))}
                                      className="block text-left font-semibold text-slate-900 hover:text-primary-700 dark:text-slate-100 dark:hover:text-primary-200"
                                    >
                                      {item.name}
                                    </button>
                                    <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                                      <span className="rounded-full border border-slate-200 px-2 py-0.5 font-semibold dark:border-slate-700">
                                        {item.type === "folder" ? "Prefix" : "Object"}
                                      </span>
                                      {item.storageClass && (
                                        <span
                                          className={`rounded-full border px-2 py-0.5 font-semibold ${
                                            storageClassChipClasses[item.storageClass] ??
                                            "border-slate-200 text-slate-600 dark:border-slate-700 dark:text-slate-300"
                                          }`}
                                        >
                                          {item.storageClass}
                                        </span>
                                      )}
                                    </div>
                                  </div>
                                </div>
                              </td>
                              <td className="px-6 py-4 text-sm text-slate-600 dark:text-slate-300">{item.size}</td>
                              <td className="px-6 py-4 text-sm text-slate-600 dark:text-slate-300">{item.modified}</td>
                              <td className="px-6 py-4 text-sm text-slate-600 dark:text-slate-300">{item.owner}</td>
                              <td className="px-6 py-4 text-right">
                                <div className="flex flex-wrap justify-end gap-2">
                                  <button
                                    type="button"
                                    className={iconButtonClasses}
                                    aria-label="Open"
                                    title="Open"
                                    onClick={() => handleOpenItem(item)}
                                    disabled={item.type !== "folder"}
                                  >
                                    <OpenIcon />
                                  </button>
                                  <button
                                    type="button"
                                    className={iconButtonClasses}
                                    aria-label="Preview"
                                    title="Preview"
                                    disabled={item.type === "folder"}
                                    onClick={() => setActiveItem(item)}
                                  >
                                    <EyeIcon />
                                  </button>
                                  <button
                                    type="button"
                                    className={iconButtonClasses}
                                    aria-label="Download"
                                    title="Download"
                                    disabled={item.type === "folder"}
                                  >
                                    <DownloadIcon />
                                  </button>
                                  <button
                                    type="button"
                                    className={iconButtonDangerClasses}
                                    aria-label="Delete"
                                    title="Delete"
                                  >
                                    <TrashIcon />
                                  </button>
                                  <button
                                    type="button"
                                    className={iconButtonClasses}
                                    aria-label="More actions"
                                    title="More"
                                    onClick={() => setActiveItem(item)}
                                  >
                                    <MoreIcon />
                                  </button>
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <div className="grid gap-3 p-3 sm:grid-cols-2 lg:grid-cols-3">
                      {filteredItems.length === 0 && (
                        <div className="col-span-full rounded-lg border border-dashed border-slate-200 px-4 py-6 text-center text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
                          No objects found for this path.
                        </div>
                      )}
                      {filteredItems.map((item) => {
                        const selected = selectedSet.has(item.id);
                        return (
                          <div
                            key={item.id}
                            className={`flex flex-col gap-3 rounded-xl border px-3 py-3 transition ${
                              selected
                                ? "border-primary-200 bg-primary-50/50 dark:border-primary-700/60 dark:bg-primary-900/20"
                                : "border-slate-200 bg-white hover:border-primary-200 hover:shadow-sm dark:border-slate-800 dark:bg-slate-900/40 dark:hover:border-primary-700/60"
                            }`}
                          >
                            <div className="flex items-start justify-between">
                              <input
                                type="checkbox"
                                checked={selected}
                                onChange={() => toggleSelection(item.id)}
                                aria-label={`Select ${item.name}`}
                                className="h-4 w-4 rounded border-slate-300 text-primary focus:ring-primary dark:border-slate-600"
                              />
                              <button
                                type="button"
                                className={iconButtonClasses}
                                aria-label="Focus"
                                onClick={() => setActiveItem(item)}
                              >
                                <MoreIcon />
                              </button>
                            </div>
                            <button
                              type="button"
                              onClick={() => (item.type === "folder" ? handleOpenItem(item) : setActiveItem(item))}
                              className="flex items-center gap-2 text-left"
                            >
                              <span className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-200">
                                {item.type === "folder" ? <FolderIcon /> : <FileIcon />}
                              </span>
                              <span className="text-sm font-semibold text-slate-900 dark:text-slate-100">{item.name}</span>
                            </button>
                            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                              <span className="rounded-full border border-slate-200 px-2 py-0.5 font-semibold dark:border-slate-700">
                                {item.type === "folder" ? "Prefix" : "Object"}
                              </span>
                              {item.storageClass && (
                                <span
                                  className={`rounded-full border px-2 py-0.5 font-semibold ${
                                    storageClassChipClasses[item.storageClass] ??
                                    "border-slate-200 text-slate-600 dark:border-slate-700 dark:text-slate-300"
                                  }`}
                                >
                                  {item.storageClass}
                                </span>
                              )}
                            </div>
                            <div className="text-xs text-slate-500 dark:text-slate-400">
                              Size: {item.size} | Modified: {item.modified}
                            </div>
                            <div className="mt-auto flex flex-wrap gap-2">
                              <button
                                type="button"
                                className={bulkActionClasses}
                                disabled={item.type === "folder"}
                                onClick={() => setActiveItem(item)}
                              >
                                Preview
                              </button>
                              <button
                                type="button"
                                className={bulkActionClasses}
                                disabled={item.type === "folder"}
                              >
                                Download
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                <div className="space-y-4">
                  <div className="rounded-xl border border-slate-200 bg-white px-4 py-4 dark:border-slate-800 dark:bg-slate-900/40">
                    <div className="flex items-center justify-between gap-2">
                      <div>
                        <p className="text-sm font-semibold text-slate-900 dark:text-slate-50">Inspector</p>
                        <p className="text-xs text-slate-500 dark:text-slate-400">
                          {inspectedItem ? "Object details and metadata" : "Select an object to inspect."}
                        </p>
                      </div>
                      {inspectedItem && (
                        <button
                          type="button"
                          onClick={() => setActiveItem(null)}
                          className="text-xs font-semibold text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
                        >
                          Clear
                        </button>
                      )}
                    </div>

                    {inspectedItem ? (
                      <div className="mt-4 space-y-4">
                        <div className="rounded-xl border border-slate-200/80 bg-gradient-to-br from-slate-50 via-white to-sky-50 px-3 py-3 shadow-sm dark:border-slate-800 dark:from-slate-900 dark:via-slate-900/60 dark:to-slate-900">
                          <div className="flex items-center gap-3">
                            <div
                              className={`flex h-12 w-12 items-center justify-center rounded-lg border text-[11px] font-bold ${
                                isImageFile(inspectedItem.name)
                                  ? "border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-500/40 dark:bg-sky-900/30 dark:text-sky-200"
                                  : "border-slate-200 bg-white text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                              }`}
                            >
                              {previewLabelForItem(inspectedItem)}
                            </div>
                            <div>
                              <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                                {inspectedItem.name}
                              </p>
                              <p className="text-xs text-slate-500 dark:text-slate-400">
                                {inspectedItem.type === "folder" ? "Prefix" : "Object"} | {inspectedItem.size}
                              </p>
                            </div>
                          </div>
                          <div className="mt-3 flex flex-wrap gap-2">
                            <button type="button" className={bulkActionClasses} disabled={inspectedItem.type === "folder"}>
                              <DownloadIcon className="h-3.5 w-3.5" />
                              Download
                            </button>
                            <button type="button" className={bulkActionClasses}>
                              <CopyIcon className="h-3.5 w-3.5" />
                              Copy URL
                            </button>
                            <button
                              type="button"
                              className={bulkActionClasses}
                              onClick={() => (inspectedItem.type === "folder" ? handleOpenItem(inspectedItem) : undefined)}
                              disabled={inspectedItem.type !== "folder"}
                            >
                              <OpenIcon className="h-3.5 w-3.5" />
                              Open
                            </button>
                            <button type="button" className={bulkDangerClasses}>
                              <TrashIcon className="h-3.5 w-3.5" />
                              Delete
                            </button>
                          </div>
                        </div>

                        <div className="space-y-2">
                          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Metadata</p>
                          <div className="grid gap-2 text-xs text-slate-600 dark:text-slate-300">
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-slate-500">Path</span>
                              <span className="font-semibold text-slate-700 dark:text-slate-100">{inspectedPath}</span>
                            </div>
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-slate-500">Owner</span>
                              <span className="font-semibold text-slate-700 dark:text-slate-100">{inspectedItem.owner}</span>
                            </div>
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-slate-500">Last modified</span>
                              <span className="font-semibold text-slate-700 dark:text-slate-100">{inspectedItem.modified}</span>
                            </div>
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-slate-500">Content type</span>
                              <span className="font-semibold text-slate-700 dark:text-slate-100">
                                {inspectedDetails?.contentType ?? "unknown"}
                              </span>
                            </div>
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-slate-500">ETag</span>
                              <span className="font-semibold text-slate-700 dark:text-slate-100">
                                {inspectedDetails?.etag ?? "-"}
                              </span>
                            </div>
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-slate-500">Encryption</span>
                              <span className="font-semibold text-slate-700 dark:text-slate-100">
                                {inspectedDetails?.encryption ?? "None"}
                              </span>
                            </div>
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-slate-500">Retention</span>
                              <span className="font-semibold text-slate-700 dark:text-slate-100">
                                {inspectedDetails?.retention ?? "-"}
                              </span>
                            </div>
                          </div>
                        </div>

                        <div className="space-y-2">
                          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Tags</p>
                          <div className="flex flex-wrap gap-2">
                            {inspectedDetails?.tags?.length ? (
                              inspectedDetails.tags.map((tag) => (
                                <span key={tag} className={`${filterChipClasses} border-slate-200 dark:border-slate-700`}>
                                  {tag}
                                </span>
                              ))
                            ) : (
                              <span className="text-xs text-slate-500 dark:text-slate-400">No tags defined.</span>
                            )}
                          </div>
                        </div>

                        {inspectedItem.type === "file" && (
                          <div className="space-y-2">
                            <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Versions</p>
                            <div className="space-y-2">
                              {inspectedDetails?.versions?.length ? (
                                inspectedDetails.versions.map((version) => (
                                  <div
                                    key={version.id}
                                    className="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2 text-xs text-slate-600 dark:border-slate-700 dark:text-slate-300"
                                  >
                                    <div className="flex items-center gap-2">
                                      <span className="font-semibold text-slate-700 dark:text-slate-100">{version.id}</span>
                                      {version.current && (
                                        <span className="rounded-full bg-primary-100 px-2 py-0.5 text-[10px] font-semibold text-primary-800 dark:bg-primary-900/40 dark:text-primary-100">
                                          Current
                                        </span>
                                      )}
                                    </div>
                                    <span className="text-slate-500 dark:text-slate-400">
                                      {version.size} | {version.modified}
                                    </span>
                                  </div>
                                ))
                              ) : (
                                <div className="text-xs text-slate-500 dark:text-slate-400">
                                  No versions listed for this object.
                                </div>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="mt-4 space-y-4">
                        <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 text-xs text-slate-600 dark:border-slate-700 dark:bg-slate-900/40 dark:text-slate-300">
                          <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">Prefix summary</p>
                          <div className="mt-3 grid gap-2">
                            <div className="flex items-center justify-between">
                              <span className="text-slate-500">Files</span>
                              <span className="font-semibold text-slate-700 dark:text-slate-100">{pathStats.files}</span>
                            </div>
                            <div className="flex items-center justify-between">
                              <span className="text-slate-500">Folders</span>
                              <span className="font-semibold text-slate-700 dark:text-slate-100">{pathStats.folders}</span>
                            </div>
                            <div className="flex items-center justify-between">
                              <span className="text-slate-500">Total size</span>
                              <span className="font-semibold text-slate-700 dark:text-slate-100">
                                {formatBytes(pathStats.totalBytes)}
                              </span>
                            </div>
                          </div>
                        </div>

                        <div className="space-y-2">
                          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Storage classes</p>
                          <div className="flex flex-wrap gap-2">
                            {Object.keys(pathStats.storageCounts).length === 0 ? (
                              <span className="text-xs text-slate-500 dark:text-slate-400">No file data yet.</span>
                            ) : (
                              Object.entries(pathStats.storageCounts).map(([storage, count]) => (
                                <span
                                  key={storage}
                                  className={`rounded-full border px-2 py-1 text-xs font-semibold ${
                                    storageClassChipClasses[storage] ??
                                    "border-slate-200 text-slate-600 dark:border-slate-700 dark:text-slate-300"
                                  }`}
                                >
                                  {storage} ({count})
                                </span>
                              ))
                            )}
                          </div>
                        </div>

                        <div className="space-y-2">
                          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Recent activity</p>
                          <div className="space-y-2">
                            {activityLog.map((activity) => (
                              <div
                                key={activity.id}
                                className="rounded-lg border border-slate-200 px-3 py-2 text-xs text-slate-600 dark:border-slate-700 dark:text-slate-300"
                              >
                                <div className="flex items-center justify-between gap-2">
                                  <span className="font-semibold text-slate-700 dark:text-slate-100">
                                    {activity.action}
                                  </span>
                                  <span className="text-slate-400">{activity.when}</span>
                                </div>
                                <p className="mt-1 text-slate-500 dark:text-slate-400">{activity.path}</p>
                                <p className="mt-1 text-slate-400">by {activity.actor}</p>
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="rounded-xl border border-slate-200 bg-white px-4 py-4 dark:border-slate-800 dark:bg-slate-900/40">
                    <div className="flex items-center justify-between gap-2">
                      <div>
                        <p className="text-sm font-semibold text-slate-900 dark:text-slate-50">Transfers</p>
                        <p className="text-xs text-slate-500 dark:text-slate-400">Live operations for this account.</p>
                      </div>
                      <button
                        type="button"
                        className="text-xs font-semibold text-slate-500 transition hover:text-primary dark:text-slate-400 dark:hover:text-primary-200"
                      >
                        View all
                      </button>
                    </div>
                    <div className="mt-3 space-y-3">
                      {operations.map((op) => (
                        <div key={op.id} className="space-y-2 rounded-lg border border-slate-200 px-3 py-3 dark:border-slate-700">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${statusClasses(op.status)}`}>
                              {statusLabel(op.status)}
                            </span>
                            <span className="text-xs text-slate-500 dark:text-slate-400">{op.progress}%</span>
                          </div>
                          <p className="text-xs font-semibold text-slate-800 dark:text-slate-100">{op.path}</p>
                          <div className="h-2 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
                            <div className="h-full bg-primary-500" style={{ width: `${op.progress}%` }} />
                          </div>
                          <p className="text-[11px] text-slate-400">{op.label} in progress.</p>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
    </div>
  );
}
