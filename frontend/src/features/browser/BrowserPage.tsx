/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useEffect, useMemo, useState } from "react";
import PageHeader from "../../components/PageHeader";
import SplitView from "../../components/SplitView";
import Modal from "../../components/Modal";
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

const iconButtonClasses =
  "inline-flex h-8 w-8 items-center justify-center rounded-md border border-slate-200 text-slate-600 transition hover:border-primary hover:text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:opacity-40 dark:border-slate-700 dark:text-slate-200 dark:hover:border-primary-500 dark:hover:text-primary-200";
const iconButtonDangerClasses =
  "inline-flex h-8 w-8 items-center justify-center rounded-md border border-rose-200 text-rose-600 transition hover:bg-rose-50 hover:text-rose-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose-500 disabled:opacity-40 dark:border-rose-500/50 dark:text-rose-200 dark:hover:bg-rose-900/30 dark:hover:text-rose-100";
const bulkActionClasses =
  "inline-flex items-center gap-2 rounded-full border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:border-primary hover:text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:opacity-50 dark:border-slate-700 dark:text-slate-100 dark:hover:border-primary-500 dark:hover:text-primary-100";
const bulkDangerClasses =
  "inline-flex items-center gap-2 rounded-full border border-rose-200 px-3 py-1.5 text-xs font-semibold text-rose-700 transition hover:bg-rose-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose-500 disabled:opacity-50 dark:border-rose-500/50 dark:text-rose-200 dark:hover:bg-rose-900/30";

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

const ChevronIcon = ({ className = "h-3.5 w-3.5", expanded = false }: { className?: string; expanded?: boolean }) => (
  <svg
    viewBox="0 0 20 20"
    className={`${className} ${expanded ? "rotate-90" : ""} transition-transform`}
    fill="none"
    aria-hidden="true"
  >
    <path d="M7.5 5.5 12.5 10l-5 4.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
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

export default function BrowserPage() {
  const [selectedPath, setSelectedPath] = useState(treeData[0]?.path ?? "");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({
    [treeData[0]?.path ?? ""]: true,
  });
  const [filter, setFilter] = useState("");
  const [activeItem, setActiveItem] = useState<BrowserItem | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  const expandToPath = (path: string) => {
    const segments = path.split("/").filter(Boolean);
    let current = "";
    const nextExpanded: Record<string, boolean> = {};
    segments.forEach((segment, index) => {
      current = index === 0 ? segment : `${current}/${segment}`;
      nextExpanded[current] = true;
    });
    setExpanded((prev) => ({ ...prev, ...nextExpanded }));
  };

  const handleSelectPath = (path: string) => {
    setSelectedPath(path);
    expandToPath(path);
  };

  const items = contentIndex[selectedPath] ?? [];
  const filteredItems = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const next = q ? items.filter((item) => item.name.toLowerCase().includes(q)) : items;
    return [...next].sort((a, b) => {
      if (a.type !== b.type) return a.type === "folder" ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
  }, [filter, items]);

  const pathParts = selectedPath.split("/").filter(Boolean);
  const bucketName = pathParts[0] ?? "";
  const prefixParts = pathParts.slice(1);
  const bucketOptions = useMemo(
    () => treeData.map((bucket) => ({ name: bucket.name, path: bucket.path })),
    []
  );
  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const allSelected = filteredItems.length > 0 && filteredItems.every((item) => selectedSet.has(item.id));
  const selectedCount = selectedIds.length;

  const renderTreeNode = (node: TreeNode, level = 0) => {
    const hasChildren = Boolean(node.children && node.children.length > 0);
    const isExpanded = expanded[node.path] ?? false;
    const isActive = selectedPath === node.path;
    const icon = node.type === "bucket" ? BucketIcon : FolderIcon;
    const Icon = icon;

    return (
      <div key={node.id} className="space-y-1">
        <div className="flex items-center gap-1" style={{ paddingLeft: level * 16 }}>
          {hasChildren ? (
            <button
              type="button"
              onClick={() => setExpanded((prev) => ({ ...prev, [node.path]: !isExpanded }))}
              className="inline-flex h-6 w-6 items-center justify-center rounded-md text-slate-400 transition hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800"
              aria-label={isExpanded ? "Collapse" : "Expand"}
            >
              <ChevronIcon expanded={isExpanded} />
            </button>
          ) : (
            <span className="inline-flex h-6 w-6" aria-hidden="true" />
          )}
          <button
            type="button"
            onClick={() => handleSelectPath(node.path)}
            className={`flex flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm font-medium transition ${
              isActive
                ? "bg-primary-100 text-primary-800 dark:bg-primary-900/30 dark:text-primary-100"
                : "text-slate-600 hover:bg-slate-100 hover:text-slate-800 dark:text-slate-300 dark:hover:bg-slate-800/60"
            }`}
          >
            <Icon className="h-4 w-4" />
            <span className="truncate">{node.name}</span>
          </button>
        </div>
        {hasChildren && isExpanded && (
          <div className="space-y-1">
            {node.children?.map((child) => renderTreeNode(child, level + 1))}
          </div>
        )}
      </div>
    );
  };

  const handleOpenItem = (item: BrowserItem) => {
    if (item.type !== "folder") return;
    const nextPath = `${selectedPath}/${item.name}`;
    if (contentIndex[nextPath]) {
      handleSelectPath(nextPath);
    }
  };

  useEffect(() => {
    setSelectedIds([]);
  }, [selectedPath]);

  useEffect(() => {
    setSelectedIds((prev) => prev.filter((id) => items.some((item) => item.id === id)));
  }, [items]);

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
        description="Explore buckets, prefixes, and objects for the current account."
        breadcrumbs={[{ label: "Manager" }, { label: "Browser" }]}
        actions={[
          { label: "New folder", onClick: () => {}, variant: "ghost" },
          { label: "Upload", onClick: () => {} },
        ]}
      />

      <SplitView
        leftWidth="320px"
        left={
          <div className="flex h-full flex-col gap-4 p-4">
            <div className="space-y-2">
              <p className="text-sm font-semibold text-slate-900 dark:text-slate-50">S3 paths</p>
              <div className="relative">
                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">
                  <SearchIcon />
                </span>
                <input
                  type="text"
                  placeholder="Filter buckets or prefixes"
                  className="w-full rounded-md border border-slate-200 bg-white py-2 pl-9 pr-3 text-sm text-slate-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                />
              </div>
            </div>
            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Buckets</p>
              <div className="space-y-1">{treeData.map((node) => renderTreeNode(node))}</div>
            </div>
            <div className="mt-auto rounded-xl border border-dashed border-slate-200 bg-slate-50 px-3 py-3 text-xs text-slate-500 dark:border-slate-700 dark:bg-slate-900/40 dark:text-slate-400">
              Tip: Use the icons in the list to preview, download, or delete objects quickly.
            </div>
          </div>
        }
        right={
          <div className="flex h-full flex-col">
            <div className="border-b border-slate-200 px-4 py-4 dark:border-slate-800">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div className="space-y-2">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Current path</p>
                  <div className="flex flex-wrap items-center gap-3 text-sm">
                    <div className="flex items-center gap-2 rounded-full border border-slate-200 bg-white px-2 py-1 dark:border-slate-700 dark:bg-slate-900">
                      <BucketIcon className="h-3.5 w-3.5 text-slate-500 dark:text-slate-300" />
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
                    </div>
                    {prefixParts.map((part, index) => (
                      <span key={`${part}-${index}`} className="text-sm font-semibold text-slate-700 dark:text-slate-200">
                        / {part}
                      </span>
                    ))}
                  </div>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    {filteredItems.length} item(s) in this prefix.
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    className="rounded-md border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 transition hover:border-primary hover:text-primary dark:border-slate-700 dark:text-slate-200 dark:hover:border-primary-500 dark:hover:text-primary-200"
                  >
                    Refresh
                  </button>
                  <button
                    type="button"
                    className="rounded-md bg-primary px-3 py-2 text-xs font-semibold text-white shadow-sm transition hover:bg-primary-600"
                  >
                    Upload
                  </button>
                </div>
              </div>
              <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
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
                <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                  <span className="rounded-full border border-slate-200 px-2 py-1 font-semibold dark:border-slate-700">
                    STANDARD
                  </span>
                  <span className="rounded-full border border-slate-200 px-2 py-1 font-semibold dark:border-slate-700">
                    IA
                  </span>
                  <span className="rounded-full border border-slate-200 px-2 py-1 font-semibold dark:border-slate-700">
                    GLACIER
                  </span>
                </div>
              </div>
              {selectedCount > 0 && (
                <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600 dark:border-slate-700 dark:bg-slate-900/40 dark:text-slate-300">
                  <div className="flex items-center gap-2">
                    <span className="rounded-full bg-slate-200 px-2 py-0.5 text-[11px] font-semibold text-slate-700 dark:bg-slate-800 dark:text-slate-200">
                      {selectedCount} selected
                    </span>
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
            <div className="flex-1 overflow-x-auto">
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
                            <div className="mt-1 flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                              <span className="rounded-full border border-slate-200 px-2 py-0.5 font-semibold dark:border-slate-700">
                                {item.type === "folder" ? "Prefix" : "Object"}
                              </span>
                              {item.storageClass && (
                                <span className="rounded-full border border-slate-200 px-2 py-0.5 font-semibold dark:border-slate-700">
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
          </div>
        }
      />

      <div className="rounded-2xl border border-slate-200/80 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div className="border-b border-slate-200 px-4 py-3 dark:border-slate-800">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="text-sm font-semibold text-slate-900 dark:text-slate-50">Operations in progress</p>
              <p className="text-xs text-slate-500 dark:text-slate-400">Live tasks for this account.</p>
            </div>
            <button
              type="button"
              className="rounded-md border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 transition hover:border-primary hover:text-primary dark:border-slate-700 dark:text-slate-200 dark:hover:border-primary-500 dark:hover:text-primary-200"
            >
              View all
            </button>
          </div>
        </div>
        <div className="divide-y divide-slate-200 dark:divide-slate-800">
          {operations.map((op) => (
            <div key={op.id} className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex flex-col gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${statusClasses(op.status)}`}>
                    {statusLabel(op.status)}
                  </span>
                  <span className="text-sm font-semibold text-slate-900 dark:text-slate-50">{op.path}</span>
                </div>
                <div className="text-xs text-slate-500 dark:text-slate-400">{op.label} in progress.</div>
              </div>
              <div className="w-full max-w-sm space-y-2">
                <div className="flex items-center justify-between text-xs font-semibold text-slate-500 dark:text-slate-400">
                  <span>Progress</span>
                  <span>{op.progress}%</span>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
                  <div className="h-full bg-primary-500" style={{ width: `${op.progress}%` }} />
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {activeItem && (
        <Modal title={`Actions for ${activeItem.name}`} onClose={() => setActiveItem(null)}>
          <div className="space-y-4">
            <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600 dark:border-slate-700 dark:bg-slate-900/40 dark:text-slate-300">
              <p className="font-semibold text-slate-900 dark:text-slate-100">Object details</p>
              <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                Path: {selectedPath}/{activeItem.name}
              </p>
              <div className="mt-3 grid gap-2 text-xs text-slate-500 dark:text-slate-400 sm:grid-cols-2">
                <span>Type: {activeItem.type}</span>
                <span>Owner: {activeItem.owner}</span>
                <span>Size: {activeItem.size}</span>
                <span>Modified: {activeItem.modified}</span>
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <button
                type="button"
                className="rounded-lg border border-slate-200 px-4 py-3 text-left text-sm font-semibold text-slate-700 transition hover:border-primary hover:text-primary dark:border-slate-700 dark:text-slate-200 dark:hover:border-primary-500 dark:hover:text-primary-200"
              >
                Manage access (ACL)
                <span className="mt-1 block text-xs text-slate-500 dark:text-slate-400">
                  Share or restrict permissions.
                </span>
              </button>
              <button
                type="button"
                className="rounded-lg border border-slate-200 px-4 py-3 text-left text-sm font-semibold text-slate-700 transition hover:border-primary hover:text-primary dark:border-slate-700 dark:text-slate-200 dark:hover:border-primary-500 dark:hover:text-primary-200"
              >
                Metadata
                <span className="mt-1 block text-xs text-slate-500 dark:text-slate-400">
                  View or edit object headers.
                </span>
              </button>
              <button
                type="button"
                className="rounded-lg border border-slate-200 px-4 py-3 text-left text-sm font-semibold text-slate-700 transition hover:border-primary hover:text-primary dark:border-slate-700 dark:text-slate-200 dark:hover:border-primary-500 dark:hover:text-primary-200"
              >
                Generate signed URL
                <span className="mt-1 block text-xs text-slate-500 dark:text-slate-400">
                  Temporary sharing link.
                </span>
              </button>
              <button
                type="button"
                className="rounded-lg border border-slate-200 px-4 py-3 text-left text-sm font-semibold text-slate-700 transition hover:border-primary hover:text-primary dark:border-slate-700 dark:text-slate-200 dark:hover:border-primary-500 dark:hover:text-primary-200"
              >
                Change storage class
                <span className="mt-1 block text-xs text-slate-500 dark:text-slate-400">
                  Move between STANDARD or GLACIER.
                </span>
              </button>
              <button
                type="button"
                className="rounded-lg border border-rose-200 px-4 py-3 text-left text-sm font-semibold text-rose-700 transition hover:bg-rose-50 dark:border-rose-500/50 dark:text-rose-200 dark:hover:bg-rose-900/30"
              >
                Delete object
                <span className="mt-1 block text-xs text-rose-500 dark:text-rose-300">
                  Removes all versions.
                </span>
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
