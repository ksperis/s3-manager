/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useEffect, useMemo, useRef, useState, type ChangeEvent, type DragEvent, type KeyboardEvent as ReactKeyboardEvent } from "react";
import axios from "axios";
import TableEmptyState from "../../components/TableEmptyState";
import {
  BrowserBucket,
  BrowserObject,
  BrowserObjectVersion,
  BucketCorsStatus,
  ObjectMetadata,
  ObjectTag,
  StsStatus,
  copyObject,
  createFolder,
  deleteObjects,
  fetchObjectMetadata,
  getBucketCorsStatus,
  ensureBucketCors,
  getObjectTags,
  getStsStatus,
  initiateMultipartUpload,
  listBrowserBuckets,
  listBrowserObjects,
  listObjectVersions,
  presignPart,
  presignObject,
  proxyDownload,
  proxyUpload,
  completeMultipartUpload,
  abortMultipartUpload,
} from "../../api/browser";
import { useS3AccountContext } from "../manager/S3AccountContext";

type BrowserItem = {
  id: string;
  key: string;
  name: string;
  type: "folder" | "file";
  size: string;
  sizeBytes?: number | null;
  modified: string;
  modifiedAt?: number | null;
  owner: string;
  storageClass?: string;
};

type TreeNode = {
  id: string;
  name: string;
  prefix: string;
  children: TreeNode[];
  isExpanded: boolean;
  isLoaded: boolean;
  isLoading: boolean;
};

type OperationItem = {
  id: string;
  label: string;
  path: string;
  progress: number;
  status: "uploading" | "deleting" | "copying";
};

type UploadCandidate = {
  file: File;
  relativePath?: string;
};

type ActivityItem = {
  id: string;
  action: string;
  path: string;
  actor: string;
  when: string;
};

const iconButtonClasses =
  "inline-flex h-7 w-7 items-center justify-center rounded-md border border-slate-200 text-slate-600 transition hover:border-primary hover:text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:opacity-40 dark:border-slate-700 dark:text-slate-200 dark:hover:border-primary-500 dark:hover:text-primary-200";
const iconButtonDangerClasses =
  "inline-flex h-7 w-7 items-center justify-center rounded-md border border-rose-200 text-rose-600 transition hover:bg-rose-50 hover:text-rose-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose-500 disabled:opacity-40 dark:border-rose-500/50 dark:text-rose-200 dark:hover:bg-rose-900/30 dark:hover:text-rose-100";
const bulkActionClasses =
  "inline-flex items-center gap-2 rounded-full border border-slate-200 px-2.5 py-1 text-[11px] font-semibold text-slate-700 transition hover:border-primary hover:text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:opacity-50 dark:border-slate-700 dark:text-slate-100 dark:hover:border-primary-500 dark:hover:text-primary-100";
const bulkDangerClasses =
  "inline-flex items-center gap-2 rounded-full border border-rose-200 px-2.5 py-1 text-[11px] font-semibold text-rose-700 transition hover:bg-rose-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose-500 disabled:opacity-50 dark:border-rose-500/50 dark:text-rose-200 dark:hover:bg-rose-900/30";
const toolbarButtonClasses =
  "inline-flex items-center gap-2 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] font-semibold text-slate-700 shadow-sm transition hover:border-primary hover:text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:border-primary-500 dark:hover:text-primary-100";
const toolbarPrimaryClasses =
  "inline-flex items-center gap-2 rounded-md bg-primary px-2.5 py-1.5 text-[11px] font-semibold text-white shadow-sm transition hover:bg-primary-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary";
const filterChipClasses =
  "inline-flex items-center gap-2 rounded-full border border-slate-200 px-2.5 py-0.5 text-[11px] font-semibold text-slate-600 transition hover:border-primary hover:text-primary dark:border-slate-700 dark:text-slate-200 dark:hover:border-primary-500 dark:hover:text-primary-100";
const filterChipActiveClasses =
  "border-primary-200 bg-primary-100 text-primary-800 dark:border-primary-600 dark:bg-primary-500/20 dark:text-primary-100";
const viewToggleBaseClasses =
  "inline-flex h-7 w-7 items-center justify-center rounded-md text-slate-500 transition hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-100";
const viewToggleActiveClasses = "bg-primary-100 text-primary-700 dark:bg-primary-500/20 dark:text-primary-100";
const breadcrumbIconButtonClasses =
  "inline-flex h-6 w-6 items-center justify-center rounded-md border border-slate-200 text-slate-500 transition hover:border-primary hover:text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:opacity-40 dark:border-slate-700 dark:text-slate-300 dark:hover:border-primary-500 dark:hover:text-primary-200";

const treeToggleButtonClasses =
  "inline-flex h-4 w-4 items-center justify-center rounded border border-slate-200 text-[9px] font-semibold text-slate-500 transition hover:border-primary hover:text-primary disabled:opacity-40 dark:border-slate-700 dark:text-slate-400 dark:hover:border-primary-500 dark:hover:text-primary-200";
const treeItemBaseClasses =
  "flex min-w-0 flex-1 items-center gap-2 rounded-md px-1.5 py-0.5 text-left text-[11px] font-semibold transition";
const treeItemActiveClasses =
  "bg-primary-100 text-primary-800 dark:bg-primary-500/20 dark:text-primary-100";
const treeItemInactiveClasses =
  "text-slate-600 hover:bg-slate-100 hover:text-slate-800 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-slate-100";

const storageClassChipClasses: Record<string, string> = {
  STANDARD: "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/40 dark:bg-emerald-900/20 dark:text-emerald-200",
  STANDARD_IA: "border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-500/40 dark:bg-sky-900/20 dark:text-sky-200",
  GLACIER: "border-indigo-200 bg-indigo-50 text-indigo-700 dark:border-indigo-500/40 dark:bg-indigo-900/20 dark:text-indigo-200",
};

const MULTIPART_THRESHOLD = 25 * 1024 * 1024;
const PART_SIZE = 8 * 1024 * 1024;
const MULTIPART_CONCURRENCY = 4;
const MULTI_FILE_CONCURRENCY = 3;
const OBJECTS_PAGE_SIZE = 200;
const VERSIONS_PAGE_SIZE = 200;

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

const formatDateTime = (value?: string | null): string => {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const pad = (num: number) => `${num}`.padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(
    date.getMinutes()
  )}`;
};

const normalizePrefix = (value: string) => {
  if (!value) return "";
  return value.endsWith("/") ? value : `${value}/`;
};

const shortName = (key: string, basePrefix: string) => {
  if (!basePrefix) return key;
  if (key.startsWith(basePrefix)) return key.slice(basePrefix.length);
  return key;
};

const buildTreeNodes = (prefixes: string[], parentPrefix: string): TreeNode[] => {
  const base = normalizePrefix(parentPrefix);
  return prefixes
    .map((prefixValue) => {
      const rawName = shortName(prefixValue, base);
      const name = rawName.endsWith("/") ? rawName.slice(0, -1) : rawName;
      return {
        id: prefixValue,
        name: name || prefixValue,
        prefix: prefixValue,
        children: [],
        isExpanded: false,
        isLoaded: false,
        isLoading: false,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
};

const updateTreeNodes = (
  nodes: TreeNode[],
  targetPrefix: string,
  updater: (node: TreeNode) => TreeNode
): TreeNode[] => {
  return nodes.map((node) => {
    if (node.prefix === targetPrefix) {
      return updater(node);
    }
    if (node.children.length === 0) {
      return node;
    }
    return { ...node, children: updateTreeNodes(node.children, targetPrefix, updater) };
  });
};

const makeId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const isLikelyCorsError = (error: unknown) => {
  if (!axios.isAxiosError(error)) return false;
  if (!error.response) return true;
  return error.code === "ERR_NETWORK" || error.message === "Network Error";
};

const normalizeEtag = (raw?: string | string[] | null): string | undefined => {
  if (!raw) return undefined;
  const value = Array.isArray(raw) ? raw[0] : raw;
  return value?.replace(/"/g, "");
};

type WebkitEntry = {
  isFile: boolean;
  isDirectory: boolean;
  name: string;
  file?: (success: (file: File) => void, error?: (error: unknown) => void) => void;
  createReader?: () => { readEntries: (success: (entries: WebkitEntry[]) => void, error?: (error: unknown) => void) => void };
};

const normalizeUploadPath = (value: string) => value.replace(/\\/g, "/").replace(/^\/+/, "");

const extractRelativePath = (file: File) => {
  const relative = (file as { webkitRelativePath?: string }).webkitRelativePath;
  return relative && relative.length > 0 ? relative : file.name;
};

const buildUploadCandidates = (files: File[]): UploadCandidate[] =>
  files.map((file) => ({ file, relativePath: extractRelativePath(file) }));

const getWebkitEntry = (item: DataTransferItem): WebkitEntry | null => {
  const cast = item as DataTransferItem & { webkitGetAsEntry?: () => WebkitEntry | null };
  return cast.webkitGetAsEntry ? cast.webkitGetAsEntry() : null;
};

const readDirectoryEntries = (reader: { readEntries: (success: (entries: WebkitEntry[]) => void, error?: (error: unknown) => void) => void }) =>
  new Promise<WebkitEntry[]>((resolve, reject) => {
    reader.readEntries(resolve, reject);
  });

const walkEntry = async (entry: WebkitEntry, parentPath: string): Promise<UploadCandidate[]> => {
  if (entry.isFile && entry.file) {
    const file = await new Promise<File>((resolve, reject) => entry.file?.(resolve, reject));
    return [{ file, relativePath: `${parentPath}${file.name}` }];
  }
  if (entry.isDirectory && entry.createReader) {
    const reader = entry.createReader();
    const entries: WebkitEntry[] = [];
    while (true) {
      const batch = await readDirectoryEntries(reader);
      if (batch.length === 0) break;
      entries.push(...batch);
    }
    const nextPath = `${parentPath}${entry.name}/`;
    const nested = await Promise.all(entries.map((child) => walkEntry(child, nextPath)));
    return nested.flat();
  }
  return [];
};

const collectDroppedFiles = async (dataTransfer: DataTransfer): Promise<UploadCandidate[]> => {
  const items = Array.from(dataTransfer.items || []);
  const entries = items
    .map((item) => getWebkitEntry(item))
    .filter((entry): entry is WebkitEntry => Boolean(entry));
  if (entries.length > 0) {
    const groups = await Promise.all(entries.map((entry) => walkEntry(entry, "")));
    return groups.flat();
  }
  return buildUploadCandidates(Array.from(dataTransfer.files || []));
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

const buildVersionRows = (versions: BrowserObjectVersion[], deleteMarkers: BrowserObjectVersion[]) => {
  const entries = [...versions, ...deleteMarkers].map((entry) => ({
    ...entry,
    is_delete_marker: entry.is_delete_marker || false,
  }));
  return entries.sort((a, b) => {
    const dateA = a.last_modified ? new Date(a.last_modified).getTime() : 0;
    const dateB = b.last_modified ? new Date(b.last_modified).getTime() : 0;
    return dateB - dateA;
  });
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

const UpIcon = ({ className = "h-4 w-4" }: { className?: string }) => (
  <svg viewBox="0 0 20 20" className={className} fill="none" aria-hidden="true">
    <path d="M9 4l-4 4 4 4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M5 8h6a4 4 0 0 1 4 4v4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
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

const ChevronDownIcon = ({ className = "h-4 w-4" }: { className?: string }) => (
  <svg viewBox="0 0 20 20" className={className} fill="none" aria-hidden="true">
    <path d="m5 7 5 5 5-5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

export default function BrowserPage() {
  const { accountIdForApi, hasS3AccountContext } = useS3AccountContext();
  const [buckets, setBuckets] = useState<BrowserBucket[]>([]);
  const [bucketName, setBucketName] = useState("");
  const [prefix, setPrefix] = useState("");
  const [objects, setObjects] = useState<BrowserObject[]>([]);
  const [prefixes, setPrefixes] = useState<string[]>([]);
  const [objectsNextToken, setObjectsNextToken] = useState<string | null>(null);
  const [objectsIsTruncated, setObjectsIsTruncated] = useState(false);
  const [showPrefixVersions, setShowPrefixVersions] = useState(false);
  const [showFolders, setShowFolders] = useState(true);
  const [showInspector, setShowInspector] = useState(false);
  const [compactMode, setCompactMode] = useState(true);
  const [prefixVersions, setPrefixVersions] = useState<BrowserObjectVersion[]>([]);
  const [prefixDeleteMarkers, setPrefixDeleteMarkers] = useState<BrowserObjectVersion[]>([]);
  const [prefixVersionsLoading, setPrefixVersionsLoading] = useState(false);
  const [prefixVersionsError, setPrefixVersionsError] = useState<string | null>(null);
  const [prefixVersionKeyMarker, setPrefixVersionKeyMarker] = useState<string | null>(null);
  const [prefixVersionIdMarker, setPrefixVersionIdMarker] = useState<string | null>(null);
  const [objectVersions, setObjectVersions] = useState<BrowserObjectVersion[]>([]);
  const [objectDeleteMarkers, setObjectDeleteMarkers] = useState<BrowserObjectVersion[]>([]);
  const [objectVersionsLoading, setObjectVersionsLoading] = useState(false);
  const [objectVersionsError, setObjectVersionsError] = useState<string | null>(null);
  const [objectVersionKeyMarker, setObjectVersionKeyMarker] = useState<string | null>(null);
  const [objectVersionIdMarker, setObjectVersionIdMarker] = useState<string | null>(null);
  const [loadingBuckets, setLoadingBuckets] = useState(false);
  const [bucketError, setBucketError] = useState<string | null>(null);
  const [objectsLoading, setObjectsLoading] = useState(false);
  const [objectsLoadingMore, setObjectsLoadingMore] = useState(false);
  const [objectsError, setObjectsError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [warningMessage, setWarningMessage] = useState<string | null>(null);
  const [corsStatus, setCorsStatus] = useState<BucketCorsStatus | null>(null);
  const [stsStatus, setStsStatus] = useState<StsStatus | null>(null);
  const [useProxyTransfers, setUseProxyTransfers] = useState(false);
  const [treeNodes, setTreeNodes] = useState<TreeNode[]>([]);
  const [corsFixing, setCorsFixing] = useState(false);
  const [corsFixError, setCorsFixError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [activeItem, setActiveItem] = useState<BrowserItem | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [viewMode, setViewMode] = useState<"list" | "grid">("list");
  const [typeFilter, setTypeFilter] = useState<"all" | "file" | "folder">("all");
  const [storageFilter, setStorageFilter] = useState<string>("all");
  const [sortId, setSortId] = useState("name-asc");
  const [operations, setOperations] = useState<OperationItem[]>([]);
  const [activityLog, setActivityLog] = useState<ActivityItem[]>([]);
  const [inspectedMetadata, setInspectedMetadata] = useState<ObjectMetadata | null>(null);
  const [inspectedTags, setInspectedTags] = useState<ObjectTag[]>([]);
  const [metadataLoading, setMetadataLoading] = useState(false);
  const [metadataError, setMetadataError] = useState<string | null>(null);
  const [isEditingPath, setIsEditingPath] = useState(false);
  const [pathDraft, setPathDraft] = useState("");
  const [showUploadMenu, setShowUploadMenu] = useState(false);
  const [dragging, setDragging] = useState(false);
  const dragCounter = useRef(0);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const folderInputRef = useRef<HTMLInputElement | null>(null);
  const uploadMenuRef = useRef<HTMLDivElement | null>(null);
  const pathInputRef = useRef<HTMLInputElement | null>(null);

  const normalizedPrefix = useMemo(() => normalizePrefix(prefix), [prefix]);
  const uiOrigin = useMemo(
    () => (typeof window === "undefined" ? undefined : window.location.origin),
    []
  );
  const warnings = useMemo(() => {
    const items: string[] = [];
    if (warningMessage) {
      items.push(warningMessage);
    }
    if (corsFixError) {
      items.push(corsFixError);
    }
    const corsDisabled = Boolean(corsStatus && !corsStatus.enabled);
    const stsDisabled = Boolean(stsStatus && !stsStatus.available);
    const stripTrailingPeriod = (value: string) => (value.endsWith(".") ? value.slice(0, -1) : value);
    const normalizeStsError = (value?: string | null) => {
      if (!value) return null;
      if (value.includes("GetCallerIdentity")) return "STS is unavailable.";
      return value;
    };
    const stsError = normalizeStsError(stsStatus?.error) ?? "STS is not available for this account.";
    if (useProxyTransfers) {
      const reasons: string[] = [];
      if (corsDisabled) {
        reasons.push(corsStatus?.error ?? "Bucket CORS is not enabled.");
      }
      if (stsDisabled) {
        reasons.push(stsError);
      }
      if (reasons.length > 0) {
        const reasonText = reasons.map(stripTrailingPeriod).join("; ");
        items.push(`Backend proxy is active for uploads/downloads (${reasonText}).`);
      } else {
        items.push("Backend proxy is active for uploads/downloads.");
      }
      return items;
    }
    if (corsDisabled) {
      items.push(corsStatus?.error ?? "Bucket CORS is not enabled.");
    }
    return items;
  }, [corsFixError, corsStatus, stsStatus, useProxyTransfers, warningMessage]);

  useEffect(() => {
    if (!folderInputRef.current) return;
    folderInputRef.current.setAttribute("webkitdirectory", "");
    folderInputRef.current.setAttribute("directory", "");
  }, []);

  useEffect(() => {
    if (!showUploadMenu) return;
    const handleMouseDown = (event: MouseEvent) => {
      if (uploadMenuRef.current && !uploadMenuRef.current.contains(event.target as Node)) {
        setShowUploadMenu(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setShowUploadMenu(false);
      }
    };
    document.addEventListener("mousedown", handleMouseDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleMouseDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [showUploadMenu]);

  useEffect(() => {
    if (!hasS3AccountContext) {
      setBuckets([]);
      setBucketName("");
      setPrefix("");
      return;
    }
    let isMounted = true;
    setLoadingBuckets(true);
    setBucketError(null);
    listBrowserBuckets(accountIdForApi)
      .then((data) => {
        if (!isMounted) return;
        setBuckets(data);
        setBucketName((prev) => {
          if (prev && data.some((bucket) => bucket.name === prev)) {
            return prev;
          }
          const next = data[0]?.name ?? "";
          if (next !== prev) {
            setPrefix("");
          }
          return next;
        });
      })
      .catch(() => {
        if (!isMounted) return;
        setBucketError("Unable to list buckets for this account.");
        setBuckets([]);
        setBucketName("");
        setPrefix("");
      })
      .finally(() => {
        if (isMounted) {
          setLoadingBuckets(false);
        }
      });
    return () => {
      isMounted = false;
    };
  }, [accountIdForApi, hasS3AccountContext]);

  const loadObjects = async (opts?: { append?: boolean; continuationToken?: string | null; prefixOverride?: string }) => {
    if (!bucketName || !hasS3AccountContext) return;
    const targetPrefix = normalizePrefix(opts?.prefixOverride ?? prefix);
    if (!opts?.append) {
      setObjectsLoading(true);
      setObjectsLoadingMore(false);
      setObjectsError(null);
      setObjectsNextToken(null);
      setObjectsIsTruncated(false);
    } else {
      setObjectsLoadingMore(true);
    }
    const query = filter.trim();
    try {
      const data = await listBrowserObjects(accountIdForApi, bucketName, {
        prefix: targetPrefix,
        continuationToken: opts?.continuationToken ?? undefined,
        maxKeys: OBJECTS_PAGE_SIZE,
        query: query || undefined,
        type: typeFilter,
        storageClass: storageFilter,
      });
      setObjects((prev) => (opts?.append ? [...prev, ...data.objects] : data.objects));
      setPrefixes((prev) => {
        if (!opts?.append) {
          return data.prefixes;
        }
        const merged = [...prev, ...data.prefixes];
        return Array.from(new Set(merged));
      });
      setObjectsNextToken(data.next_continuation_token ?? null);
      setObjectsIsTruncated(data.is_truncated);
    } catch (err) {
      setObjectsError("Unable to list objects for this prefix.");
      if (!opts?.append) {
        setObjects([]);
        setPrefixes([]);
        setObjectsNextToken(null);
        setObjectsIsTruncated(false);
      }
    } finally {
      if (!opts?.append) {
        setObjectsLoading(false);
      } else {
        setObjectsLoadingMore(false);
      }
    }
  };

  const loadPrefixVersions = async (opts?: { append?: boolean; keyMarker?: string | null; versionIdMarker?: string | null }) => {
    if (!bucketName || !hasS3AccountContext) return;
    if (!opts?.append) {
      setPrefixVersionsLoading(true);
      setPrefixVersionsError(null);
    } else {
      setPrefixVersionsLoading(true);
    }
    const resolvedKeyMarker = opts?.keyMarker !== undefined ? opts.keyMarker : prefixVersionKeyMarker;
    const resolvedVersionIdMarker = opts?.versionIdMarker !== undefined ? opts.versionIdMarker : prefixVersionIdMarker;
    try {
      const data = await listObjectVersions(accountIdForApi, bucketName, {
        prefix: normalizedPrefix,
        keyMarker: resolvedKeyMarker ?? undefined,
        versionIdMarker: resolvedVersionIdMarker ?? undefined,
        maxKeys: VERSIONS_PAGE_SIZE,
      });
      setPrefixVersionKeyMarker(data.next_key_marker ?? null);
      setPrefixVersionIdMarker(data.next_version_id_marker ?? null);
      setPrefixVersions((prev) => (opts?.append ? [...prev, ...data.versions] : data.versions));
      setPrefixDeleteMarkers((prev) => (opts?.append ? [...prev, ...data.delete_markers] : data.delete_markers));
    } catch (err) {
      setPrefixVersionsError("Unable to list versions for this prefix.");
      if (!opts?.append) {
        setPrefixVersions([]);
        setPrefixDeleteMarkers([]);
      }
    } finally {
      setPrefixVersionsLoading(false);
    }
  };

  const loadObjectVersions = async (opts?: {
    append?: boolean;
    keyMarker?: string | null;
    versionIdMarker?: string | null;
    targetKey?: string | null;
  }) => {
    if (!bucketName || !hasS3AccountContext) return;
    const targetKey = opts?.targetKey ?? inspectedItem?.key ?? null;
    if (!targetKey) return;
    if (!opts?.append) {
      setObjectVersionsLoading(true);
      setObjectVersionsError(null);
    } else {
      setObjectVersionsLoading(true);
    }
    const resolvedKeyMarker = opts?.keyMarker !== undefined ? opts.keyMarker : objectVersionKeyMarker;
    const resolvedVersionIdMarker = opts?.versionIdMarker !== undefined ? opts.versionIdMarker : objectVersionIdMarker;
    try {
      const data = await listObjectVersions(accountIdForApi, bucketName, {
        key: targetKey,
        keyMarker: resolvedKeyMarker ?? undefined,
        versionIdMarker: resolvedVersionIdMarker ?? undefined,
        maxKeys: VERSIONS_PAGE_SIZE,
      });
      setObjectVersionKeyMarker(data.next_key_marker ?? null);
      setObjectVersionIdMarker(data.next_version_id_marker ?? null);
      setObjectVersions((prev) => (opts?.append ? [...prev, ...data.versions] : data.versions));
      setObjectDeleteMarkers((prev) => (opts?.append ? [...prev, ...data.delete_markers] : data.delete_markers));
    } catch (err) {
      setObjectVersionsError("Unable to list versions for this object.");
      if (!opts?.append) {
        setObjectVersions([]);
        setObjectDeleteMarkers([]);
      }
    } finally {
      setObjectVersionsLoading(false);
    }
  };

  useEffect(() => {
    if (!bucketName || !hasS3AccountContext) {
      setObjects([]);
      setPrefixes([]);
      setObjectsNextToken(null);
      setObjectsIsTruncated(false);
      setObjectsLoadingMore(false);
      return;
    }
    loadObjects({ prefixOverride: prefix });
  }, [accountIdForApi, bucketName, filter, hasS3AccountContext, prefix, storageFilter, typeFilter]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!showPrefixVersions || !bucketName || !hasS3AccountContext) {
      setPrefixVersions([]);
      setPrefixDeleteMarkers([]);
      setPrefixVersionsError(null);
      setPrefixVersionKeyMarker(null);
      setPrefixVersionIdMarker(null);
      return;
    }
    setPrefixVersionKeyMarker(null);
    setPrefixVersionIdMarker(null);
    loadPrefixVersions({ append: false, keyMarker: null, versionIdMarker: null });
  }, [accountIdForApi, bucketName, hasS3AccountContext, normalizedPrefix, showPrefixVersions]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!bucketName || !hasS3AccountContext) {
      setTreeNodes([]);
      return;
    }
    let isMounted = true;
    const rootNode: TreeNode = {
      id: "root",
      name: bucketName,
      prefix: "",
      children: [],
      isExpanded: true,
      isLoaded: false,
      isLoading: true,
    };
    setTreeNodes([rootNode]);
    const loadRoot = async () => {
      try {
        const data = await listBrowserObjects(accountIdForApi, bucketName, { prefix: "" });
        if (!isMounted) return;
        const children = buildTreeNodes(data.prefixes, "");
        setTreeNodes([
          {
            ...rootNode,
            children,
            isExpanded: true,
            isLoaded: true,
            isLoading: false,
          },
        ]);
      } catch {
        if (!isMounted) return;
        setTreeNodes([{ ...rootNode, isLoaded: true, isLoading: false }]);
      }
    };
    loadRoot();
    return () => {
      isMounted = false;
    };
  }, [accountIdForApi, bucketName, hasS3AccountContext]);

  useEffect(() => {
    if (!bucketName || !hasS3AccountContext) {
      setCorsStatus(null);
      setUseProxyTransfers(false);
      return;
    }
    let isMounted = true;
    getBucketCorsStatus(accountIdForApi, bucketName, uiOrigin)
      .then((status) => {
        if (!isMounted) return;
        setCorsStatus(status);
        setUseProxyTransfers(!status.enabled);
        setCorsFixError(null);
      })
      .catch(() => {
        if (!isMounted) return;
        setCorsStatus({ enabled: false, rules: [], error: "Unable to check bucket CORS." });
        setUseProxyTransfers(true);
      });
    return () => {
      isMounted = false;
    };
  }, [accountIdForApi, bucketName, hasS3AccountContext, uiOrigin]);

  useEffect(() => {
    if (!hasS3AccountContext) {
      setStsStatus(null);
      return;
    }
    let isMounted = true;
    getStsStatus(accountIdForApi)
      .then((status) => {
        if (!isMounted) return;
        setStsStatus(status);
      })
      .catch(() => {
        if (!isMounted) return;
        setStsStatus({ available: false, error: "Unable to reach STS endpoint." });
      });
    return () => {
      isMounted = false;
    };
  }, [accountIdForApi, hasS3AccountContext]);

  const items = useMemo(() => {
    const folderItems = prefixes.map((prefixKey) => {
      const rawName = shortName(prefixKey, normalizedPrefix);
      const name = rawName.endsWith("/") ? rawName.slice(0, -1) : rawName;
      return {
        id: prefixKey,
        key: prefixKey,
        name: name || prefixKey,
        type: "folder",
        size: "-",
        sizeBytes: null,
        modified: "-",
        modifiedAt: null,
        owner: "-",
      } satisfies BrowserItem;
    });
    const objectItems = objects.map((obj) => {
      const modifiedAt = obj.last_modified ? new Date(obj.last_modified).getTime() : null;
      return {
        id: obj.key,
        key: obj.key,
        name: shortName(obj.key, normalizedPrefix),
        type: "file",
        size: formatBytes(obj.size),
        sizeBytes: obj.size,
        modified: formatDateTime(obj.last_modified),
        modifiedAt,
        owner: "-",
        storageClass: obj.storage_class ?? undefined,
      } satisfies BrowserItem;
    });
    return [...folderItems, ...objectItems];
  }, [normalizedPrefix, objects, prefixes]);

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
    return [...items].sort((a, b) => {
      if (a.type !== b.type) return a.type === "folder" ? -1 : 1;
      if (activeSort.key === "size") {
        const aSize = a.sizeBytes ?? 0;
        const bSize = b.sizeBytes ?? 0;
        return activeSort.direction === "asc" ? aSize - bSize : bSize - aSize;
      }
      if (activeSort.key === "modified") {
        const result = (a.modifiedAt ?? 0) - (b.modifiedAt ?? 0);
        return activeSort.direction === "asc" ? result : -result;
      }
      const result = a.name.localeCompare(b.name);
      return activeSort.direction === "asc" ? result : -result;
    });
  }, [activeSort.direction, activeSort.key, items]);

  const prefixParts = useMemo(() => prefix.split("/").filter(Boolean), [prefix]);
  const bucketOptions = useMemo(() => buckets.map((bucket) => bucket.name), [buckets]);

  const breadcrumbs = useMemo(() => {
    let current = "";
    return prefixParts.map((part) => {
      current = `${current}${part}/`;
      return { label: part, prefix: current };
    });
  }, [prefixParts]);

  const parentPrefix = useMemo(() => {
    if (prefixParts.length <= 1) return "";
    return `${prefixParts.slice(0, -1).join("/")}/`;
  }, [prefixParts]);
  const canGoUp = prefixParts.length > 0;

  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const allSelected = filteredItems.length > 0 && filteredItems.every((item) => selectedSet.has(item.id));
  const selectedItems = useMemo(() => items.filter((item) => selectedSet.has(item.id)), [items, selectedSet]);
  const selectedCount = selectedItems.length;
  const selectedFiles = selectedItems.filter((item) => item.type === "file");
  const hasFolderSelection = selectedItems.some((item) => item.type === "folder");
  const canBulkActions = selectedFiles.length > 0 && !hasFolderSelection;
  const selectedBytes = useMemo(() => {
    return selectedItems.reduce((sum, item) => sum + (item.sizeBytes ?? 0), 0);
  }, [selectedItems]);

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
      totalBytes += item.sizeBytes ?? 0;
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

  const layoutClass = showFolders && showInspector
    ? "xl:grid-cols-[200px_minmax(0,1fr)_320px]"
    : showFolders
      ? "xl:grid-cols-[200px_minmax(0,1fr)]"
      : showInspector
        ? "xl:grid-cols-[minmax(0,1fr)_320px]"
        : "xl:grid-cols-[minmax(0,1fr)]";
  const rowPadding = compactMode ? "py-2" : "py-4";
  const headerPadding = compactMode ? "py-2" : "py-3";
  const iconBoxClasses = compactMode ? "h-7 w-7" : "h-9 w-9";
  const nameGapClasses = compactMode ? "gap-2" : "gap-3";

  const prefixVersionRows = useMemo(
    () => buildVersionRows(prefixVersions, prefixDeleteMarkers),
    [prefixDeleteMarkers, prefixVersions]
  );
  const objectVersionRows = useMemo(
    () => buildVersionRows(objectVersions, objectDeleteMarkers),
    [objectDeleteMarkers, objectVersions]
  );

  const currentPath = useMemo(() => {
    if (!bucketName) return "";
    if (!prefix) return bucketName;
    const trimmed = prefix.endsWith("/") ? prefix.slice(0, -1) : prefix;
    return `${bucketName}/${trimmed}`;
  }, [bucketName, prefix]);
  const inspectedPath = inspectedItem ? `${bucketName}/${inspectedItem.key}` : currentPath;

  const handleOpenItem = (item: BrowserItem) => {
    if (item.type !== "folder") return;
    handleSelectPrefix(item.key);
  };

  const handlePreviewItem = (item: BrowserItem) => {
    setActiveItem(item);
    setShowInspector(true);
  };

  const handleSelectPrefix = (nextPrefix: string) => {
    setPrefix(nextPrefix);
    setActiveItem(null);
  };

  const startEditingPath = () => {
    if (!bucketName) return;
    setPathDraft(prefix);
    setIsEditingPath(true);
  };

  const commitPathDraft = () => {
    const trimmed = pathDraft.trim().replace(/^\/+/, "");
    const nextPrefix = trimmed ? normalizePrefix(trimmed) : "";
    setIsEditingPath(false);
    if (nextPrefix !== prefix) {
      handleSelectPrefix(nextPrefix);
    }
  };

  const cancelPathEdit = () => {
    setPathDraft(prefix);
    setIsEditingPath(false);
  };

  const handlePathKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      commitPathDraft();
    }
    if (event.key === "Escape") {
      event.preventDefault();
      cancelPathEdit();
    }
  };

  useEffect(() => {
    setSelectedIds([]);
    setActiveItem(null);
    setStatusMessage(null);
    setWarningMessage(null);
    setIsEditingPath(false);
  }, [bucketName, prefix]);

  useEffect(() => {
    if (!isEditingPath) {
      setPathDraft(prefix);
      return;
    }
    pathInputRef.current?.focus();
    pathInputRef.current?.select();
  }, [isEditingPath, prefix]);

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

  useEffect(() => {
    if (!bucketName || !inspectedItem || inspectedItem.type === "folder" || !hasS3AccountContext) {
      setInspectedMetadata(null);
      setInspectedTags([]);
      setMetadataError(null);
      setMetadataLoading(false);
      return;
    }
    let isMounted = true;
    setMetadataLoading(true);
    setMetadataError(null);
    Promise.all([
      fetchObjectMetadata(accountIdForApi, bucketName, inspectedItem.key),
      getObjectTags(accountIdForApi, bucketName, inspectedItem.key),
    ])
      .then(([meta, tags]) => {
        if (!isMounted) return;
        setInspectedMetadata(meta);
        setInspectedTags(tags.tags ?? []);
      })
      .catch(() => {
        if (!isMounted) return;
        setMetadataError("Unable to load object details.");
        setInspectedMetadata(null);
        setInspectedTags([]);
      })
      .finally(() => {
        if (isMounted) {
          setMetadataLoading(false);
        }
      });
    return () => {
      isMounted = false;
    };
  }, [accountIdForApi, bucketName, hasS3AccountContext, inspectedItem?.key, inspectedItem?.type]);

  useEffect(() => {
    if (!bucketName || !hasS3AccountContext || !inspectedItem || inspectedItem.type === "folder") {
      setObjectVersions([]);
      setObjectDeleteMarkers([]);
      setObjectVersionsError(null);
      setObjectVersionKeyMarker(null);
      setObjectVersionIdMarker(null);
      return;
    }
    setObjectVersionKeyMarker(null);
    setObjectVersionIdMarker(null);
    loadObjectVersions({ append: false, keyMarker: null, versionIdMarker: null, targetKey: inspectedItem.key });
  }, [accountIdForApi, bucketName, hasS3AccountContext, inspectedItem?.key, inspectedItem?.type]); // eslint-disable-line react-hooks/exhaustive-deps

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
    if (!value || value === bucketName) return;
    setBucketName(value);
    setPrefix("");
    setActiveItem(null);
  };

  const handleRefresh = () => {
    if (!bucketName) return;
    loadObjects({ prefixOverride: prefix });
    if (showPrefixVersions) {
      loadPrefixVersions({ append: false, keyMarker: null, versionIdMarker: null });
    }
    if (inspectedItem?.type === "file") {
      loadObjectVersions({ append: false, keyMarker: null, versionIdMarker: null, targetKey: inspectedItem.key });
    }
  };

  const loadTreeChildren = async (targetPrefix: string) => {
    if (!bucketName || !hasS3AccountContext) return;
    const normalized = targetPrefix ? normalizePrefix(targetPrefix) : "";
    setTreeNodes((prev) =>
      updateTreeNodes(prev, targetPrefix, (node) => ({ ...node, isLoading: true }))
    );
    try {
      const data = await listBrowserObjects(accountIdForApi, bucketName, { prefix: normalized });
      const children = buildTreeNodes(data.prefixes, normalized);
      setTreeNodes((prev) =>
        updateTreeNodes(prev, targetPrefix, (node) => ({
          ...node,
          children,
          isExpanded: true,
          isLoaded: true,
          isLoading: false,
        }))
      );
    } catch {
      setTreeNodes((prev) =>
        updateTreeNodes(prev, targetPrefix, (node) => ({
          ...node,
          isLoaded: true,
          isLoading: false,
        }))
      );
    }
  };

  const handleToggleTreeNode = (node: TreeNode) => {
    if (node.isExpanded) {
      setTreeNodes((prev) =>
        updateTreeNodes(prev, node.prefix, (entry) => ({ ...entry, isExpanded: false }))
      );
      return;
    }
    if (!node.isLoaded) {
      loadTreeChildren(node.prefix);
      return;
    }
    setTreeNodes((prev) =>
      updateTreeNodes(prev, node.prefix, (entry) => ({ ...entry, isExpanded: true }))
    );
  };

  const renderTreeNodes = (nodes: TreeNode[], depth = 0) => (
    <ul className="space-y-1">
      {nodes.map((node) => {
        const isActive = prefix === node.prefix;
        const canToggle = node.isLoaded ? node.children.length > 0 : true;
        const labelClasses = `${treeItemBaseClasses} ${isActive ? treeItemActiveClasses : treeItemInactiveClasses}`;
        return (
          <li key={node.id}>
            <div className="flex items-center gap-1" style={{ paddingLeft: depth * 12 }}>
              <button
                type="button"
                className={treeToggleButtonClasses}
                onClick={() => handleToggleTreeNode(node)}
                disabled={!canToggle}
                aria-label={node.isExpanded ? "Collapse" : "Expand"}
              >
                {canToggle ? (node.isExpanded ? "-" : "+") : ""}
              </button>
              <button
                type="button"
                className={labelClasses}
                onClick={() => handleSelectPrefix(node.prefix)}
                title={node.name}
              >
                {node.prefix === "" ? <BucketIcon className="h-3.5 w-3.5" /> : <FolderIcon className="h-3.5 w-3.5" />}
                <span className="truncate">{node.name}</span>
              </button>
            </div>
            {node.isExpanded && (
              <div className="mt-1">
                {node.isLoading ? (
                  <div className="pl-6 text-xs text-slate-400 dark:text-slate-500">Loading...</div>
                ) : node.children.length === 0 ? (
                  <div className="pl-6 text-xs text-slate-400 dark:text-slate-500">No folders</div>
                ) : (
                  renderTreeNodes(node.children, depth + 1)
                )}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );

  const handleEnsureCors = async () => {
    if (!bucketName || !hasS3AccountContext || !uiOrigin) return;
    setCorsFixing(true);
    setCorsFixError(null);
    setStatusMessage(null);
    try {
      const status = await ensureBucketCors(accountIdForApi, bucketName, uiOrigin);
      setCorsStatus(status);
      setUseProxyTransfers(!status.enabled);
      if (status.enabled) {
        setStatusMessage("CORS rules updated for this bucket.");
      } else {
        setCorsFixError(status.error ?? "CORS is still not enabled for this origin.");
      }
    } catch (err) {
      setCorsFixError("Unable to update bucket CORS configuration.");
    } finally {
      setCorsFixing(false);
    }
  };

  const handleGoUp = () => {
    if (!canGoUp) return;
    handleSelectPrefix(parentPrefix);
  };

  const addActivity = (action: string, path: string) => {
    setActivityLog((prev) => [{ id: makeId(), action, path, actor: "You", when: new Date().toLocaleTimeString() }, ...prev].slice(0, 6));
  };

  const handleNewFolder = async () => {
    if (!bucketName || !hasS3AccountContext) return;
    const name = window.prompt("Folder name:");
    if (!name) return;
    const clean = name.replace(/^\/+|\/+$/g, "");
    if (!clean) return;
    const folderPrefix = `${normalizedPrefix}${clean}/`;
    try {
      await createFolder(accountIdForApi, bucketName, folderPrefix);
      addActivity("Created", `${bucketName}/${folderPrefix}`);
      setStatusMessage(`Folder ${clean} created`);
      await loadObjects({ prefixOverride: prefix });
      loadTreeChildren(prefix);
    } catch (err) {
      setStatusMessage("Unable to create folder.");
    }
  };

  const handleUploadFiles = async (items: UploadCandidate[]) => {
    if (!bucketName || !hasS3AccountContext || items.length === 0) return;
    setWarningMessage(null);
    const queue = [...items];
    const workerCount = Math.min(MULTI_FILE_CONCURRENCY, queue.length);
    const workers = Array.from({ length: workerCount }, async () => {
      while (queue.length > 0) {
        const next = queue.shift();
        if (!next) return;
        await startUpload(next);
      }
    });
    await Promise.all(workers);
  };

  const uploadSimple = async (file: File, key: string, onProgress: (event: ProgressEvent) => void) => {
    if (!bucketName || !hasS3AccountContext) return;
    if (useProxyTransfers) {
      await proxyUpload(accountIdForApi, bucketName, key, file, onProgress);
      return;
    }
    const presign = await presignObject(accountIdForApi, bucketName, {
      key,
      operation: "put_object",
      content_type: file.type || undefined,
      expires_in: 1800,
    });
    await axios.put(presign.url, file, {
      headers: { ...(presign.headers || {}), "Content-Type": file.type || "application/octet-stream" },
      onUploadProgress: onProgress,
    });
  };

  const uploadMultipart = async (file: File, key: string, operationId: string) => {
    if (!bucketName || !hasS3AccountContext) return;
    let uploadId: string | null = null;
    const totalParts = Math.ceil(file.size / PART_SIZE);
    const partProgress = new Map<number, number>();
    const controller = new AbortController();

    const updateProgress = () => {
      const loaded = Array.from(partProgress.values()).reduce((sum, value) => sum + value, 0);
      const percent = file.size ? Math.min(99, Math.round((loaded / file.size) * 100)) : 0;
      setOperations((prev) => prev.map((op) => (op.id === operationId ? { ...op, progress: percent } : op)));
    };

    const recordProgress = (partNumber: number, loadedBytes: number, partSize: number) => {
      partProgress.set(partNumber, Math.min(loadedBytes, partSize));
      updateProgress();
    };

    const partsQueue = Array.from({ length: totalParts }, (_, index) => {
      const partNumber = index + 1;
      const start = index * PART_SIZE;
      const end = Math.min(start + PART_SIZE, file.size);
      return { partNumber, start, end, size: end - start };
    });

    const uploadedParts: { part_number: number; etag: string }[] = [];

    const uploadPart = async (part: { partNumber: number; start: number; end: number; size: number }) => {
      if (!uploadId) {
        throw new Error("Missing multipart upload ID.");
      }
      const blob = file.slice(part.start, part.end);
      const presignedPart = await presignPart(accountIdForApi, bucketName, uploadId, {
        key,
        part_number: part.partNumber,
        expires_in: 1800,
      });
      const response = await axios.put(presignedPart.url, blob, {
        headers: presignedPart.headers || {},
        signal: controller.signal,
        onUploadProgress: (event) => {
          const loaded = event.loaded ?? 0;
          recordProgress(part.partNumber, loaded, part.size);
        },
      });
      const etag = normalizeEtag(response.headers?.etag || response.headers?.ETag || response.headers?.ETAG);
      if (!etag) {
        throw new Error("Missing ETag from multipart upload.");
      }
      uploadedParts.push({ part_number: part.partNumber, etag });
      recordProgress(part.partNumber, part.size, part.size);
    };

    try {
      setOperations((prev) => prev.map((op) => (op.id === operationId ? { ...op, label: "Multipart upload" } : op)));
      const init = await initiateMultipartUpload(accountIdForApi, bucketName, {
        key,
        content_type: file.type || undefined,
      });
      uploadId = init.upload_id;
      let hasError = false;
      const workerCount = Math.min(MULTIPART_CONCURRENCY, partsQueue.length);
      const workers = Array.from({ length: workerCount }, async () => {
        while (partsQueue.length > 0 && !hasError) {
          const part = partsQueue.shift();
          if (!part) return;
          try {
            await uploadPart(part);
          } catch (err) {
            hasError = true;
            controller.abort();
            throw err;
          }
        }
      });
      await Promise.all(workers);
      setOperations((prev) => prev.map((op) => (op.id === operationId ? { ...op, progress: 95 } : op)));
      uploadedParts.sort((a, b) => a.part_number - b.part_number);
      await completeMultipartUpload(accountIdForApi, bucketName, uploadId, key, { parts: uploadedParts });
      setOperations((prev) => prev.map((op) => (op.id === operationId ? { ...op, progress: 100 } : op)));
    } catch (err) {
      if (uploadId) {
        try {
          await abortMultipartUpload(accountIdForApi, bucketName, uploadId, key);
        } catch {
          // ignore abort failures
        }
      }
      throw err;
    }
  };

  const startUpload = async (item: UploadCandidate) => {
    if (!bucketName || !hasS3AccountContext) return;
    const file = item.file;
    const relativePath = normalizeUploadPath(item.relativePath || file.name);
    const key = `${normalizedPrefix}${relativePath}`;
    const operationId = makeId();
    setOperations((prev) => [
      { id: operationId, label: "Uploading", path: `${bucketName}/${key}`, progress: 0, status: "uploading" },
      ...prev,
    ]);
    try {
      if (!useProxyTransfers && file.size >= MULTIPART_THRESHOLD) {
        await uploadMultipart(file, key, operationId);
      } else {
        const onProgress = (event: ProgressEvent) => {
          const total = event.total ?? file.size;
          const progress = total ? Math.round((event.loaded / total) * 100) : 0;
          setOperations((prev) => prev.map((op) => (op.id === operationId ? { ...op, progress } : op)));
        };
        await uploadSimple(file, key, onProgress);
      }
      setOperations((prev) => prev.filter((op) => op.id !== operationId));
      addActivity("Uploaded", `${bucketName}/${key}`);
      setStatusMessage(`Uploaded ${relativePath}`);
      await loadObjects({ prefixOverride: prefix });
    } catch (err) {
      setOperations((prev) => prev.filter((op) => op.id !== operationId));
      setStatusMessage(`Upload failed for ${relativePath}`);
      if (!useProxyTransfers && isLikelyCorsError(err)) {
        setWarningMessage(
          `Possible CORS or endpoint issue. Ensure bucket CORS allows origin ${window.location.origin} with PUT/GET/HEAD and headers like Content-Type or x-amz-*.`
        );
      }
    }
  };

  const handleFileInputChange = (event: ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files ? Array.from(event.target.files) : [];
    handleUploadFiles(buildUploadCandidates(files));
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const handleFolderInputChange = (event: ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files ? Array.from(event.target.files) : [];
    handleUploadFiles(buildUploadCandidates(files));
    if (folderInputRef.current) {
      folderInputRef.current.value = "";
    }
  };

  const isFileDrag = (event: DragEvent<HTMLDivElement>) => {
    const types = Array.from(event.dataTransfer?.types || []);
    if (types.includes("Files")) return true;
    return Array.from(event.dataTransfer?.items || []).some((item) => item.kind === "file");
  };

  const handleDragEnter = (event: DragEvent<HTMLDivElement>) => {
    if (!isFileDrag(event)) return;
    event.preventDefault();
    dragCounter.current += 1;
    setDragging(true);
  };

  const handleDragOver = (event: DragEvent<HTMLDivElement>) => {
    if (!isFileDrag(event)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    setDragging(true);
  };

  const handleDragLeave = (event: DragEvent<HTMLDivElement>) => {
    if (!dragging) return;
    event.preventDefault();
    dragCounter.current = Math.max(0, dragCounter.current - 1);
    if (dragCounter.current === 0) {
      setDragging(false);
    }
  };

  const handleDrop = async (event: DragEvent<HTMLDivElement>) => {
    if (!isFileDrag(event)) return;
    event.preventDefault();
    dragCounter.current = 0;
    setDragging(false);
    const files = await collectDroppedFiles(event.dataTransfer);
    if (files.length === 0) return;
    if (!bucketName || !hasS3AccountContext) {
      setStatusMessage("Select a bucket before uploading.");
      return;
    }
    handleUploadFiles(files);
  };

  const handleDownloadItems = async (targets: BrowserItem[]) => {
    if (!bucketName || !hasS3AccountContext || targets.length === 0) return;
    setWarningMessage(null);
    try {
      for (const item of targets) {
        if (item.type !== "file") continue;
        if (useProxyTransfers) {
          const blob = await proxyDownload(accountIdForApi, bucketName, item.key);
          const url = window.URL.createObjectURL(blob);
          const link = document.createElement("a");
          link.href = url;
          link.download = item.name || "download";
          document.body.appendChild(link);
          link.click();
          link.remove();
          window.URL.revokeObjectURL(url);
        } else {
          const presign = await presignObject(accountIdForApi, bucketName, {
            key: item.key,
            operation: "get_object",
            expires_in: 900,
          });
          window.open(presign.url, "_blank");
        }
      }
    } catch (err) {
      setStatusMessage(useProxyTransfers ? "Unable to download object." : "Unable to generate download URL.");
    }
  };

  const handleDeleteItems = async (targets: BrowserItem[]) => {
    if (!bucketName || !hasS3AccountContext || targets.length === 0) return;
    const fileTargets = targets.filter((item) => item.type === "file");
    if (fileTargets.length === 0) return;
    setWarningMessage(null);
    const confirmed = window.confirm(`Delete ${fileTargets.length} object(s)?`);
    if (!confirmed) return;
    try {
      await deleteObjects(
        accountIdForApi,
        bucketName,
        fileTargets.map((item) => ({ key: item.key }))
      );
      fileTargets.forEach((item) => addActivity("Deleted", `${bucketName}/${item.key}`));
      setSelectedIds((prev) => prev.filter((id) => !fileTargets.some((item) => item.id === id)));
      setStatusMessage(`Deleted ${fileTargets.length} object(s)`);
      await loadObjects({ prefixOverride: prefix });
    } catch (err) {
      setStatusMessage("Unable to delete objects.");
    }
  };

  const refreshVersionsForKey = async (targetKey: string) => {
    if (showPrefixVersions) {
      await loadPrefixVersions({ append: false, keyMarker: null, versionIdMarker: null });
    }
    if (inspectedItem?.type === "file" && inspectedItem.key === targetKey) {
      await loadObjectVersions({ append: false, keyMarker: null, versionIdMarker: null, targetKey });
    }
  };

  const handleRestoreVersion = async (item: BrowserObjectVersion) => {
    if (!bucketName || !hasS3AccountContext || !item.version_id || item.is_delete_marker) return;
    setWarningMessage(null);
    try {
      await copyObject(accountIdForApi, bucketName, {
        source_key: item.key,
        source_version_id: item.version_id,
        destination_key: item.key,
        replace_metadata: false,
        move: false,
      });
      addActivity("Restored", `${bucketName}/${item.key}`);
      setStatusMessage(`Restored version ${item.version_id}`);
      await loadObjects({ prefixOverride: prefix });
      await refreshVersionsForKey(item.key);
    } catch (err) {
      setStatusMessage("Unable to restore version.");
    }
  };

  const handleDeleteVersion = async (item: BrowserObjectVersion) => {
    if (!bucketName || !hasS3AccountContext || !item.version_id) return;
    setWarningMessage(null);
    const label = item.is_delete_marker ? "delete marker" : "version";
    const confirmed = window.confirm(`Delete ${label} for ${item.key}?`);
    if (!confirmed) return;
    try {
      await deleteObjects(accountIdForApi, bucketName, [{ key: item.key, version_id: item.version_id }]);
      addActivity(item.is_delete_marker ? "Removed delete marker" : "Deleted version", `${bucketName}/${item.key}`);
      setStatusMessage(item.is_delete_marker ? "Delete marker removed." : "Version deleted.");
      await loadObjects({ prefixOverride: prefix });
      await refreshVersionsForKey(item.key);
    } catch (err) {
      setStatusMessage(item.is_delete_marker ? "Unable to delete marker." : "Unable to delete version.");
    }
  };

  const handleCopyUrl = async (item: BrowserItem | null) => {
    if (!bucketName || !hasS3AccountContext || !item || item.type !== "file") return;
    try {
      const presign = await presignObject(accountIdForApi, bucketName, {
        key: item.key,
        operation: "get_object",
        expires_in: 900,
      });
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(presign.url);
        setStatusMessage("URL copied to clipboard.");
      } else {
        window.prompt("Copy URL:", presign.url);
      }
    } catch (err) {
      setStatusMessage("Unable to copy URL.");
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
    <div className="space-y-3">
      <div className="rounded-lg border border-slate-200/80 bg-white/90 shadow-sm dark:border-slate-800 dark:bg-slate-900/70">
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 px-2 py-1.5 dark:border-slate-800">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Browser</span>
          <div className="flex flex-wrap items-center gap-2 rounded-md border border-slate-200 bg-white px-2 py-0.5 text-[11px] font-semibold text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200">
            <BucketIcon className="h-3.5 w-3.5 text-slate-500 dark:text-slate-300" />
            <select
              className="bg-transparent text-[11px] font-semibold text-slate-700 focus:outline-none dark:text-slate-200"
              value={bucketName || ""}
              onChange={(event) => handleBucketChange(event.target.value)}
              disabled={loadingBuckets || bucketOptions.length === 0}
            >
              {loadingBuckets && <option value="">Loading buckets...</option>}
              {!loadingBuckets && bucketOptions.length === 0 && <option value="">No buckets</option>}
              {!loadingBuckets && bucketOptions.length > 0 && !bucketName && <option value="">Select bucket</option>}
              {bucketOptions.map((bucket) => (
                <option key={bucket} value={bucket}>
                  {bucket}
                </option>
              ))}
            </select>
            <div
              className="flex flex-wrap items-center gap-1 text-[11px] font-semibold text-slate-500 dark:text-slate-400"
              onClick={isEditingPath ? undefined : startEditingPath}
            >
              {isEditingPath ? (
                <input
                  ref={pathInputRef}
                  type="text"
                  value={pathDraft}
                  onChange={(event) => setPathDraft(event.target.value)}
                  onBlur={commitPathDraft}
                  onKeyDown={handlePathKeyDown}
                  placeholder="root"
                  aria-label="Path"
                  className="min-w-[140px] flex-1 rounded-md border border-slate-200 bg-white px-2 py-0.5 text-[11px] font-semibold text-slate-700 shadow-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                  disabled={!bucketName}
                  spellCheck={false}
                />
              ) : (
                <>
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      handleGoUp();
                    }}
                    className={breadcrumbIconButtonClasses}
                    disabled={!canGoUp}
                    aria-label="Parent folder"
                    title="Parent folder"
                  >
                    <UpIcon className="h-3.5 w-3.5" />
                  </button>
                  {breadcrumbs.length === 0 ? (
                    <span className="text-slate-400">(root)</span>
                  ) : (
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        handleSelectPrefix("");
                      }}
                      className="rounded-md px-1.5 py-0.5 text-slate-600 transition hover:bg-slate-100 hover:text-slate-800 dark:text-slate-300 dark:hover:bg-slate-800"
                    >
                      root
                    </button>
                  )}
                  {breadcrumbs.map((crumb) => (
                    <span key={crumb.prefix} className="flex items-center gap-1">
                      <span className="text-slate-300">/</span>
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          handleSelectPrefix(crumb.prefix);
                        }}
                        className="rounded-md px-1.5 py-0.5 text-slate-600 transition hover:bg-slate-100 hover:text-slate-800 dark:text-slate-300 dark:hover:bg-slate-800"
                      >
                        {crumb.label}
                      </button>
                    </span>
                  ))}
                </>
              )}
            </div>
          </div>
          <span className="text-[11px] text-slate-500 dark:text-slate-400">
            {filteredItems.length} items · {pathStats.files} files · {pathStats.folders} folders
          </span>
          <div className="flex flex-wrap items-center gap-2 sm:ml-auto">
            <div className="relative w-full sm:w-44">
              <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-slate-400">
                <SearchIcon className="h-3.5 w-3.5" />
              </span>
              <input
                type="text"
                value={filter}
                onChange={(event) => setFilter(event.target.value)}
                placeholder="Filter"
                className="w-full rounded-md border border-slate-200 bg-white py-1.5 pl-7 pr-2 text-xs text-slate-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
              />
            </div>
            <select
              className="rounded-md border border-slate-200 bg-white px-2 py-1.5 text-xs font-semibold text-slate-700 shadow-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
              value={typeFilter}
              onChange={(event) => setTypeFilter(event.target.value as "all" | "file" | "folder")}
            >
              <option value="all">All</option>
              <option value="file">Files</option>
              <option value="folder">Folders</option>
            </select>
            {availableStorageClasses.length > 0 && (
              <select
                className="rounded-md border border-slate-200 bg-white px-2 py-1.5 text-xs font-semibold text-slate-700 shadow-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                value={storageFilter}
                onChange={(event) => setStorageFilter(event.target.value)}
              >
                <option value="all">Storage: All</option>
                {availableStorageClasses.map((storage) => (
                  <option key={storage} value={storage}>
                    {storage}
                  </option>
                ))}
              </select>
            )}
            <select
              className="rounded-md border border-slate-200 bg-white px-2 py-1.5 text-xs font-semibold text-slate-700 shadow-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
              value={sortId}
              onChange={(event) => setSortId(event.target.value)}
            >
              {sortOptions.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
            <div className="flex items-center gap-1 rounded-md border border-slate-200 bg-white px-1 py-1 shadow-sm dark:border-slate-700 dark:bg-slate-900">
              <button
                type="button"
                onClick={() => setViewMode("list")}
                className={`${viewToggleBaseClasses} ${viewMode === "list" ? viewToggleActiveClasses : ""}`}
                aria-label="List view"
              >
                <ListIcon className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={() => setViewMode("grid")}
                className={`${viewToggleBaseClasses} ${viewMode === "grid" ? viewToggleActiveClasses : ""}`}
                aria-label="Grid view"
              >
                <GridIcon className="h-3.5 w-3.5" />
              </button>
            </div>
            <button
              type="button"
              onClick={() => setShowFolders((prev) => !prev)}
              className={`${filterChipClasses} ${showFolders ? filterChipActiveClasses : ""}`}
            >
              Folders
            </button>
            <button
              type="button"
              onClick={() => setShowInspector((prev) => !prev)}
              className={`${filterChipClasses} ${showInspector ? filterChipActiveClasses : ""}`}
            >
              Inspector
            </button>
            <button
              type="button"
              onClick={() => setShowPrefixVersions((prev) => !prev)}
              className={`${filterChipClasses} ${showPrefixVersions ? filterChipActiveClasses : ""}`}
            >
              Versions
            </button>
            <button
              type="button"
              onClick={() => setCompactMode((prev) => !prev)}
              className={`${filterChipClasses} ${compactMode ? filterChipActiveClasses : ""}`}
            >
              Compact
            </button>
            <button
              type="button"
              className={toolbarButtonClasses}
              onClick={handleRefresh}
              disabled={!bucketName || objectsLoading}
            >
              Refresh
            </button>
            <button type="button" className={toolbarButtonClasses} onClick={handleNewFolder} disabled={!bucketName}>
              New folder
            </button>
            <div ref={uploadMenuRef} className="relative">
              <div className="inline-flex items-center">
                <button
                  type="button"
                  className={`${toolbarPrimaryClasses} rounded-r-none`}
                  onClick={() => {
                    setShowUploadMenu(false);
                    fileInputRef.current?.click();
                  }}
                  disabled={!bucketName}
                >
                  Upload
                </button>
                <button
                  type="button"
                  className={`${toolbarPrimaryClasses} rounded-l-none px-2`}
                  onClick={() => setShowUploadMenu((prev) => !prev)}
                  disabled={!bucketName}
                  aria-label="Upload options"
                >
                  <ChevronDownIcon className="h-3.5 w-3.5" />
                </button>
              </div>
              {showUploadMenu && (
                <div className="absolute right-0 z-20 mt-1 w-40 rounded-lg border border-slate-200 bg-white p-1 text-xs shadow-lg dark:border-slate-700 dark:bg-slate-900">
                  <button
                    type="button"
                    className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left font-semibold text-slate-700 transition hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800"
                    onClick={() => {
                      setShowUploadMenu(false);
                      fileInputRef.current?.click();
                    }}
                  >
                    Upload files
                  </button>
                  <button
                    type="button"
                    className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left font-semibold text-slate-700 transition hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800"
                    onClick={() => {
                      setShowUploadMenu(false);
                      folderInputRef.current?.click();
                    }}
                  >
                    Upload folder
                  </button>
                </div>
              )}
            </div>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              className="hidden"
              onChange={handleFileInputChange}
            />
            <input
              ref={folderInputRef}
              type="file"
              multiple
              className="hidden"
              onChange={handleFolderInputChange}
            />
          </div>
        </div>

        {(bucketError || objectsError || statusMessage || warnings.length > 0) && (
          <div className="border-b border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600 dark:border-slate-800 dark:bg-slate-900/40 dark:text-slate-300">
            {bucketError && <p className="font-semibold text-rose-600 dark:text-rose-200">{bucketError}</p>}
            {!bucketError && objectsError && <p className="font-semibold text-rose-600 dark:text-rose-200">{objectsError}</p>}
            {statusMessage && <p className="text-slate-500 dark:text-slate-400">{statusMessage}</p>}
            {warnings.map((warning, index) => (
              <p key={`${warning}-${index}`} className="font-semibold text-amber-600 dark:text-amber-200">
                {warning}
              </p>
            ))}
            {corsStatus && !corsStatus.enabled && uiOrigin && (
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  className={bulkActionClasses}
                  onClick={handleEnsureCors}
                  disabled={corsFixing}
                >
                  {corsFixing ? "Activation CORS..." : `Ajouter CORS pour ${uiOrigin}`}
                </button>
              </div>
            )}
          </div>
        )}

        <div className="p-2">
          <div className={`grid gap-3 ${layoutClass}`}>
            {showFolders && (
              <div className="rounded-xl border border-slate-200 bg-white/80 px-3 py-3 dark:border-slate-800 dark:bg-slate-900/40">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Folders</p>
                <div className="mt-3 max-h-[520px] overflow-auto pr-1">
                  {!bucketName ? (
                    <p className="text-xs text-slate-500 dark:text-slate-400">Select a bucket to view folders.</p>
                  ) : (
                    renderTreeNodes(treeNodes)
                  )}
                </div>
              </div>
            )}
            <div className="space-y-3">
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
                  <div className="flex flex-nowrap items-center gap-1.5 overflow-x-auto">
                    <button
                      type="button"
                      className={bulkActionClasses}
                      disabled={!canBulkActions}
                      onClick={() => handleDownloadItems(selectedFiles)}
                    >
                      <DownloadIcon className="h-3.5 w-3.5" />
                      Download
                    </button>
                    <button
                      type="button"
                      className={bulkActionClasses}
                      disabled={selectedFiles.length !== 1 || hasFolderSelection}
                      onClick={() => handleCopyUrl(selectedFiles[0] ?? null)}
                    >
                      <CopyIcon className="h-3.5 w-3.5" />
                      Copy URL
                    </button>
                    <button
                      type="button"
                      className={bulkDangerClasses}
                      disabled={!canBulkActions}
                      onClick={() => handleDeleteItems(selectedFiles)}
                    >
                      <TrashIcon className="h-3.5 w-3.5" />
                      Delete
                    </button>
                  </div>
                </div>
              )}
                  <div
                    className={`relative rounded-xl border transition ${
                      dragging
                        ? "border-primary/60 bg-primary/5 dark:border-primary-500/60 dark:bg-primary-500/10"
                        : "border-slate-200 dark:border-slate-800"
                    }`}
                    onDragEnter={handleDragEnter}
                    onDragOver={handleDragOver}
                    onDragLeave={handleDragLeave}
                    onDrop={handleDrop}
                  >
                    {dragging && (
                      <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-xl bg-slate-50/80 text-center text-sm font-semibold text-slate-600 backdrop-blur-sm dark:bg-slate-900/70 dark:text-slate-200">
                        <div>
                          <div>Drop files or folders to upload</div>
                          <div className="mt-1 text-xs font-normal text-slate-500 dark:text-slate-400">
                            {bucketName ? `${bucketName}/${normalizedPrefix}` : "Select a bucket first"}
                          </div>
                        </div>
                      </div>
                    )}
                    {viewMode === "list" ? (
                      <div className="overflow-x-auto">
                        <table className="manager-table min-w-full divide-y divide-slate-200 dark:divide-slate-800">
                          <thead className="bg-slate-50 dark:bg-slate-900/50">
                            <tr>
                              <th className={`w-9 px-2 ${headerPadding} text-left text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400`}>
                                <input
                                  type="checkbox"
                                  checked={allSelected}
                                  onChange={toggleAllSelection}
                                  aria-label="Select all"
                                  className="h-4 w-4 rounded border-slate-300 text-primary focus:ring-primary dark:border-slate-600"
                                />
                              </th>
                              <th className={`px-4 ${headerPadding} text-left text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400`}>
                                Name
                              </th>
                              <th className={`w-16 px-2 ${headerPadding} text-left text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400`}>
                                Size
                              </th>
                              <th className={`w-32 px-2 ${headerPadding} text-left text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400`}>
                                Modified
                              </th>
                              <th className={`w-44 px-2 ${headerPadding} text-right text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400`}>
                                Actions
                              </th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                            {objectsLoading && <TableEmptyState colSpan={5} message="Loading objects..." />}
                            {!objectsLoading && !bucketName && (
                              <TableEmptyState colSpan={5} message="Select a bucket to browse objects." />
                            )}
                            {!objectsLoading && bucketName && objectsError && (
                              <TableEmptyState colSpan={5} message={objectsError} />
                            )}
                            {!objectsLoading && bucketName && !objectsError && filteredItems.length === 0 && (
                              <TableEmptyState colSpan={5} message="No objects found for this path." />
                            )}
                            {filteredItems.map((item) => (
                              <tr
                                key={item.id}
                                className={`hover:bg-slate-50 dark:hover:bg-slate-800/40 ${
                                  selectedSet.has(item.id) ? "bg-primary-50/50 dark:bg-primary-500/20" : ""
                                }`}
                              >
                                <td className={`w-9 px-2 ${rowPadding}`}>
                                  <input
                                    type="checkbox"
                                    checked={selectedSet.has(item.id)}
                                    onChange={() => toggleSelection(item.id)}
                                    aria-label={`Select ${item.name}`}
                                    className="h-4 w-4 rounded border-slate-300 text-primary focus:ring-primary dark:border-slate-600"
                                  />
                                </td>
                                <td className={`manager-table-cell px-4 ${rowPadding} text-sm text-slate-700 dark:text-slate-200`}>
                                  <div className={`flex items-center ${nameGapClasses}`}>
                                    <span className={`inline-flex ${iconBoxClasses} items-center justify-center rounded-lg bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-200`}>
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
                                      {!compactMode && (
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
                                      )}
                                    </div>
                                  </div>
                                </td>
                                <td className={`px-2 ${rowPadding} text-sm text-slate-600 dark:text-slate-300`}>{item.size}</td>
                                <td className={`px-2 ${rowPadding} text-sm text-slate-600 dark:text-slate-300`}>{item.modified}</td>
                                <td className={`w-44 px-2 ${rowPadding} text-right`}>
                                  <div className="flex flex-nowrap justify-end gap-1.5">
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
                                      onClick={() => handlePreviewItem(item)}
                                      >
                                        <EyeIcon />
                                      </button>
                                    <button
                                      type="button"
                                      className={iconButtonClasses}
                                      aria-label="Download"
                                      title="Download"
                                      disabled={item.type === "folder"}
                                      onClick={() => handleDownloadItems([item])}
                                    >
                                      <DownloadIcon />
                                    </button>
                                    <button
                                      type="button"
                                      className={iconButtonDangerClasses}
                                      aria-label="Delete"
                                      title="Delete"
                                      disabled={item.type === "folder"}
                                      onClick={() => handleDeleteItems([item])}
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
                        {objectsLoading && (
                          <div className="col-span-full rounded-lg border border-dashed border-slate-200 px-4 py-6 text-center text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
                            Loading objects...
                          </div>
                        )}
                        {!objectsLoading && !bucketName && (
                          <div className="col-span-full rounded-lg border border-dashed border-slate-200 px-4 py-6 text-center text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
                            Select a bucket to browse objects.
                          </div>
                        )}
                        {!objectsLoading && bucketName && objectsError && (
                          <div className="col-span-full rounded-lg border border-dashed border-slate-200 px-4 py-6 text-center text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
                            {objectsError}
                          </div>
                        )}
                        {!objectsLoading && bucketName && !objectsError && filteredItems.length === 0 && (
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
                                  ? "border-primary-200 bg-primary-50/50 dark:border-primary-700/60 dark:bg-primary-500/20"
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
                                  onClick={() => handlePreviewItem(item)}
                                >
                                  Preview
                                </button>
                                <button
                                  type="button"
                                  className={bulkActionClasses}
                                  disabled={item.type === "folder"}
                                  onClick={() => handleDownloadItems([item])}
                                >
                                  Download
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                    {objectsIsTruncated && objectsNextToken && (
                      <div className="border-t border-slate-200 bg-slate-50 px-4 py-3 text-right dark:border-slate-800 dark:bg-slate-900/60">
                        <button
                          type="button"
                          className={toolbarButtonClasses}
                          onClick={() => loadObjects({ append: true, continuationToken: objectsNextToken })}
                          disabled={objectsLoadingMore}
                        >
                          {objectsLoadingMore ? "Loading..." : "Load more"}
                        </button>
                      </div>
                    )}
                  </div>
                  {showPrefixVersions && (
                    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900/40">
                      <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-700 dark:border-slate-800 dark:bg-slate-900/60 dark:text-slate-100">
                        <div>Versions {normalizedPrefix ? `· ${normalizedPrefix}` : ""}</div>
                        <div className="flex items-center gap-2 text-[11px] text-slate-500">
                          {prefixVersionsLoading && <span>Loading...</span>}
                          <button
                            type="button"
                            className={toolbarButtonClasses}
                            onClick={() => loadPrefixVersions({ append: false, keyMarker: null, versionIdMarker: null })}
                            disabled={!bucketName || prefixVersionsLoading}
                          >
                            Refresh
                          </button>
                        </div>
                      </div>
                      {prefixVersionsError && <div className="px-3 py-2 text-xs text-rose-500">{prefixVersionsError}</div>}
                      <div className="divide-y divide-slate-100 dark:divide-slate-800">
                        {prefixVersionRows.length === 0 && !prefixVersionsLoading && (
                          <div className="px-3 py-3 text-xs text-slate-500 dark:text-slate-300">No versions found.</div>
                        )}
                        {prefixVersionRows.map((ver) => (
                          <div
                            key={`${ver.key}-${ver.version_id ?? "none"}-${ver.is_delete_marker ? "marker" : "version"}`}
                            className="flex flex-wrap items-start justify-between gap-3 px-3 py-2 text-xs"
                          >
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="truncate font-semibold text-slate-800 dark:text-slate-100">{ver.key}</span>
                                {ver.is_delete_marker && (
                                  <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-700 dark:bg-amber-900/40 dark:text-amber-100">
                                    delete marker
                                  </span>
                                )}
                                {ver.is_latest && (
                                  <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-100">
                                    latest
                                  </span>
                                )}
                              </div>
                              <div className="flex flex-wrap gap-3 text-[11px] text-slate-500 dark:text-slate-300">
                                {ver.version_id && <span>v: {ver.version_id}</span>}
                                {ver.last_modified && <span>{formatDateTime(ver.last_modified)}</span>}
                                {ver.size != null && <span>{formatBytes(ver.size)}</span>}
                                {ver.etag && <span>ETag {ver.etag}</span>}
                                {ver.storage_class && <span>{ver.storage_class}</span>}
                              </div>
                            </div>
                            <div className="flex flex-wrap items-center gap-2">
                              {!ver.is_delete_marker && (
                                <button
                                  type="button"
                                  className={bulkActionClasses}
                                  onClick={() => handleRestoreVersion(ver)}
                                >
                                  Restore
                                </button>
                              )}
                              <button
                                type="button"
                                className={bulkDangerClasses}
                                onClick={() => handleDeleteVersion(ver)}
                              >
                                {ver.is_delete_marker ? "Delete marker" : "Delete version"}
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                      {(prefixVersionKeyMarker || prefixVersionIdMarker) && (
                        <div className="border-t border-slate-200 bg-slate-50 px-4 py-3 text-right dark:border-slate-800 dark:bg-slate-900/60">
                          <button
                            type="button"
                            className={toolbarButtonClasses}
                            onClick={() => loadPrefixVersions({ append: true })}
                            disabled={prefixVersionsLoading}
                          >
                            Load more versions
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {showInspector && (
                <div className="space-y-4">
                  <div className="rounded-lg border border-slate-200 bg-white px-3 py-3 dark:border-slate-800 dark:bg-slate-900/40">
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
                        <div className="rounded-lg border border-slate-200/80 bg-gradient-to-br from-slate-50 via-white to-sky-50 px-3 py-2.5 shadow-sm dark:border-slate-800 dark:from-slate-900 dark:via-slate-900/60 dark:to-slate-900">
                          <div className="flex items-center gap-3">
                            <div
                              className={`flex h-10 w-10 items-center justify-center rounded-lg border text-[10px] font-bold ${
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
                            <button
                              type="button"
                              className={bulkActionClasses}
                              disabled={inspectedItem.type === "folder"}
                              onClick={() => handleDownloadItems([inspectedItem])}
                            >
                              <DownloadIcon className="h-3.5 w-3.5" />
                              Download
                            </button>
                            <button
                              type="button"
                              className={bulkActionClasses}
                              disabled={inspectedItem.type === "folder"}
                              onClick={() => handleCopyUrl(inspectedItem)}
                            >
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
                            <button
                              type="button"
                              className={bulkDangerClasses}
                              disabled={inspectedItem.type === "folder"}
                              onClick={() => handleDeleteItems([inspectedItem])}
                            >
                              <TrashIcon className="h-3.5 w-3.5" />
                              Delete
                            </button>
                          </div>
                        </div>

                        <div className="space-y-2">
                          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Metadata</p>
                          {metadataLoading && (
                            <p className="text-xs text-slate-500 dark:text-slate-400">Loading metadata...</p>
                          )}
                          {metadataError && (
                            <p className="text-xs font-semibold text-rose-600 dark:text-rose-200">{metadataError}</p>
                          )}
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
                                {inspectedMetadata?.content_type ?? "unknown"}
                              </span>
                            </div>
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-slate-500">ETag</span>
                              <span className="font-semibold text-slate-700 dark:text-slate-100">
                                {inspectedMetadata?.etag ?? "-"}
                              </span>
                            </div>
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-slate-500">Storage class</span>
                              <span className="font-semibold text-slate-700 dark:text-slate-100">
                                {inspectedMetadata?.storage_class ?? inspectedItem.storageClass ?? "-"}
                              </span>
                            </div>
                          </div>
                        </div>

                        <div className="space-y-2">
                          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Tags</p>
                          <div className="flex flex-wrap gap-2">
                            {inspectedTags.length ? (
                              inspectedTags.map((tag) => (
                                <span
                                  key={`${tag.key}:${tag.value}`}
                                  className={`${filterChipClasses} border-slate-200 dark:border-slate-700`}
                                >
                                  {tag.key}
                                  {tag.value ? `=${tag.value}` : ""}
                                </span>
                              ))
                            ) : (
                              <span className="text-xs text-slate-500 dark:text-slate-400">No tags defined.</span>
                            )}
                          </div>
                        </div>
                        {inspectedItem.type === "file" && (
                          <div className="space-y-2">
                            <div className="flex items-center justify-between">
                              <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Versions</p>
                              {objectVersionsLoading && (
                                <span className="text-xs text-slate-500 dark:text-slate-400">Loading...</span>
                              )}
                            </div>
                            {objectVersionsError && (
                              <p className="text-xs font-semibold text-rose-600 dark:text-rose-200">
                                {objectVersionsError}
                              </p>
                            )}
                            <div className="space-y-2">
                              {objectVersionRows.length === 0 && !objectVersionsLoading && (
                                <span className="text-xs text-slate-500 dark:text-slate-400">No versions found.</span>
                              )}
                              {objectVersionRows.map((ver) => (
                                <div
                                  key={`${ver.key}-${ver.version_id ?? "none"}-${ver.is_delete_marker ? "marker" : "version"}`}
                                  className="rounded-lg border border-slate-200 px-3 py-2 text-xs text-slate-600 dark:border-slate-700 dark:text-slate-300"
                                >
                                  <div className="flex flex-wrap items-center justify-between gap-2">
                                    <div className="flex flex-wrap items-center gap-2">
                                      {ver.is_delete_marker && (
                                        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-700 dark:bg-amber-900/40 dark:text-amber-100">
                                          delete marker
                                        </span>
                                      )}
                                      {ver.is_latest && (
                                        <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-100">
                                          latest
                                        </span>
                                      )}
                                    </div>
                                    <div className="flex flex-wrap items-center gap-2">
                                      {!ver.is_delete_marker && (
                                        <button
                                          type="button"
                                          className={bulkActionClasses}
                                          onClick={() => handleRestoreVersion(ver)}
                                        >
                                          Restore
                                        </button>
                                      )}
                                      <button
                                        type="button"
                                        className={bulkDangerClasses}
                                        onClick={() => handleDeleteVersion(ver)}
                                      >
                                        {ver.is_delete_marker ? "Delete marker" : "Delete version"}
                                      </button>
                                    </div>
                                  </div>
                                  <div className="mt-2 space-y-1 text-[11px] text-slate-500 dark:text-slate-400">
                                    {ver.version_id && <div>v: {ver.version_id}</div>}
                                    {ver.last_modified && <div>Modified: {formatDateTime(ver.last_modified)}</div>}
                                    {ver.size != null && <div>Size: {formatBytes(ver.size)}</div>}
                                    {ver.etag && <div>ETag: {ver.etag}</div>}
                                  </div>
                                </div>
                              ))}
                            </div>
                            {(objectVersionKeyMarker || objectVersionIdMarker) && (
                              <button
                                type="button"
                                className={toolbarButtonClasses}
                                onClick={() => loadObjectVersions({ append: true })}
                                disabled={objectVersionsLoading}
                              >
                                Load more versions
                              </button>
                            )}
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
                            {activityLog.length === 0 ? (
                              <div className="text-xs text-slate-500 dark:text-slate-400">
                                No activity recorded for this session yet.
                              </div>
                            ) : (
                              activityLog.map((activity) => (
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
                              ))
                            )}
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
                        disabled
                      >
                        View all
                      </button>
                    </div>
                    <div className="mt-3 space-y-3">
                      {operations.length === 0 ? (
                        <div className="text-xs text-slate-500 dark:text-slate-400">No active transfers.</div>
                      ) : (
                        operations.map((op) => (
                          <div
                            key={op.id}
                            className="space-y-2 rounded-lg border border-slate-200 px-3 py-3 dark:border-slate-700"
                          >
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
                        ))
                      )}
                    </div>
                  </div>
                </div>
                )}
          </div>
        </div>
      </div>
    </div>
  );
}
