/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useEffect, useMemo, useRef, useState, type ChangeEvent, type KeyboardEvent } from "react";
import axios from "axios";
import PageHeader from "../../components/PageHeader";
import TableEmptyState from "../../components/TableEmptyState";
import {
  BrowserBucket,
  BrowserObject,
  BucketCorsStatus,
  ObjectMetadata,
  ObjectTag,
  StsStatus,
  createFolder,
  deleteObjects,
  fetchObjectMetadata,
  getBucketCorsStatus,
  ensureBucketCors,
  getObjectTags,
  getStsStatus,
  listBrowserBuckets,
  listBrowserObjects,
  presignObject,
  proxyDownload,
  proxyUpload,
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

type ActivityItem = {
  id: string;
  action: string;
  path: string;
  actor: string;
  when: string;
};

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
const breadcrumbIconButtonClasses =
  "inline-flex h-7 w-7 items-center justify-center rounded-md border border-slate-200 text-slate-500 transition hover:border-primary hover:text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:opacity-40 dark:border-slate-700 dark:text-slate-300 dark:hover:border-primary-500 dark:hover:text-primary-200";

const treeToggleButtonClasses =
  "inline-flex h-5 w-5 items-center justify-center rounded border border-slate-200 text-[10px] font-semibold text-slate-500 transition hover:border-primary hover:text-primary disabled:opacity-40 dark:border-slate-700 dark:text-slate-400 dark:hover:border-primary-500 dark:hover:text-primary-200";
const treeItemBaseClasses =
  "flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1 text-left text-xs font-semibold transition";
const treeItemActiveClasses =
  "bg-primary-100 text-primary-800 dark:bg-primary-900/30 dark:text-primary-100";
const treeItemInactiveClasses =
  "text-slate-600 hover:bg-slate-100 hover:text-slate-800 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-slate-100";

const storageClassChipClasses: Record<string, string> = {
  STANDARD: "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/40 dark:bg-emerald-900/20 dark:text-emerald-200",
  STANDARD_IA: "border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-500/40 dark:bg-sky-900/20 dark:text-sky-200",
  GLACIER: "border-indigo-200 bg-indigo-50 text-indigo-700 dark:border-indigo-500/40 dark:bg-indigo-900/20 dark:text-indigo-200",
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

export default function BrowserPage() {
  const { accountIdForApi, hasS3AccountContext } = useS3AccountContext();
  const [buckets, setBuckets] = useState<BrowserBucket[]>([]);
  const [bucketName, setBucketName] = useState("");
  const [prefix, setPrefix] = useState("");
  const [objects, setObjects] = useState<BrowserObject[]>([]);
  const [prefixes, setPrefixes] = useState<string[]>([]);
  const [loadingBuckets, setLoadingBuckets] = useState(false);
  const [bucketError, setBucketError] = useState<string | null>(null);
  const [objectsLoading, setObjectsLoading] = useState(false);
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
  const fileInputRef = useRef<HTMLInputElement | null>(null);
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
    if (corsStatus && !corsStatus.enabled) {
      items.push(corsStatus.error ?? "Bucket CORS is not enabled.");
    }
    if (useProxyTransfers) {
      items.push("Backend proxy is active for uploads/downloads.");
    }
    if (stsStatus && !stsStatus.available) {
      items.push(stsStatus.error ?? "STS is not available for this account.");
    }
    return items;
  }, [corsFixError, corsStatus, stsStatus, useProxyTransfers, warningMessage]);

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

  const loadObjects = async (nextPrefix?: string) => {
    if (!bucketName || !hasS3AccountContext) return;
    const targetPrefix = normalizePrefix(nextPrefix ?? prefix);
    setObjectsLoading(true);
    setObjectsError(null);
    try {
      const data = await listBrowserObjects(accountIdForApi, bucketName, { prefix: targetPrefix });
      setObjects(data.objects);
      setPrefixes(data.prefixes);
    } catch (err) {
      setObjectsError("Unable to list objects for this prefix.");
      setObjects([]);
      setPrefixes([]);
    } finally {
      setObjectsLoading(false);
    }
  };

  useEffect(() => {
    if (!bucketName || !hasS3AccountContext) {
      setObjects([]);
      setPrefixes([]);
      return;
    }
    loadObjects(prefix);
  }, [accountIdForApi, bucketName, hasS3AccountContext, prefix]); // eslint-disable-line react-hooks/exhaustive-deps

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
  }, [activeSort.direction, activeSort.key, filter, items, storageFilter, typeFilter]);

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

  const handlePathKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
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
    loadObjects(prefix);
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
      await loadObjects(prefix);
      loadTreeChildren(prefix);
    } catch (err) {
      setStatusMessage("Unable to create folder.");
    }
  };

  const handleUploadFiles = async (files: File[]) => {
    if (!bucketName || !hasS3AccountContext || files.length === 0) return;
    setWarningMessage(null);
    await Promise.all(files.map((file) => startUpload(file)));
  };

  const startUpload = async (file: File) => {
    if (!bucketName || !hasS3AccountContext) return;
    const key = `${normalizedPrefix}${file.name}`;
    const operationId = makeId();
    setOperations((prev) => [
      { id: operationId, label: "Uploading", path: `${bucketName}/${key}`, progress: 0, status: "uploading" },
      ...prev,
    ]);
    try {
      const onProgress = (event: ProgressEvent) => {
        const total = event.total ?? file.size;
        const progress = total ? Math.round((event.loaded / total) * 100) : 0;
        setOperations((prev) => prev.map((op) => (op.id === operationId ? { ...op, progress } : op)));
      };
      if (useProxyTransfers) {
        await proxyUpload(accountIdForApi, bucketName, key, file, onProgress);
      } else {
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
      }
      setOperations((prev) => prev.filter((op) => op.id !== operationId));
      addActivity("Uploaded", `${bucketName}/${key}`);
      setStatusMessage(`Uploaded ${file.name}`);
      await loadObjects(prefix);
    } catch (err) {
      setOperations((prev) => prev.filter((op) => op.id !== operationId));
      setStatusMessage(`Upload failed for ${file.name}`);
      if (!useProxyTransfers && isLikelyCorsError(err)) {
        setWarningMessage(
          `Possible CORS or endpoint issue. Ensure bucket CORS allows origin ${window.location.origin} with PUT/GET/HEAD and headers like Content-Type or x-amz-*.`
        );
      }
    }
  };

  const handleFileInputChange = (event: ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files ? Array.from(event.target.files) : [];
    handleUploadFiles(files);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
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
      await loadObjects(prefix);
    } catch (err) {
      setStatusMessage("Unable to delete objects.");
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
                        value={bucketName || ""}
                        onChange={(event) => handleBucketChange(event.target.value)}
                        disabled={loadingBuckets || bucketOptions.length === 0}
                      >
                        {loadingBuckets && <option value="">Loading buckets...</option>}
                        {!loadingBuckets && bucketOptions.length === 0 && <option value="">No buckets available</option>}
                        {!loadingBuckets && bucketOptions.length > 0 && !bucketName && (
                          <option value="">Select a bucket</option>
                        )}
                        {bucketOptions.map((bucket) => (
                          <option key={bucket} value={bucket}>
                            {bucket}
                          </option>
                        ))}
                      </select>
                      <div
                        className="flex flex-wrap items-center gap-1 text-xs font-semibold text-slate-500 dark:text-slate-400"
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
                            className="min-w-[160px] flex-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-xs font-semibold text-slate-700 shadow-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
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
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      {filteredItems.length} item(s) in this prefix. {pathStats.files} files, {pathStats.folders} folders.
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
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
                    <button
                      type="button"
                      className={toolbarPrimaryClasses}
                      onClick={() => fileInputRef.current?.click()}
                      disabled={!bucketName}
                    >
                      Upload
                    </button>
                    <input
                      ref={fileInputRef}
                      type="file"
                      multiple
                      className="hidden"
                      onChange={handleFileInputChange}
                    />
                  </div>
                </div>

                {(bucketError || objectsError || statusMessage || warnings.length > 0) && (
                  <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600 dark:border-slate-700 dark:bg-slate-900/40 dark:text-slate-300">
                    {bucketError && <p className="font-semibold text-rose-600 dark:text-rose-200">{bucketError}</p>}
                    {!bucketError && objectsError && (
                      <p className="font-semibold text-rose-600 dark:text-rose-200">{objectsError}</p>
                    )}
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
              </div>
            </div>

            <div className="flex-1 p-4">
              <div className="grid gap-4 xl:grid-cols-[220px_minmax(0,1fr)_320px]">
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
                          {objectsLoading && <TableEmptyState colSpan={6} message="Loading objects..." />}
                          {!objectsLoading && !bucketName && (
                            <TableEmptyState colSpan={6} message="Select a bucket to browse objects." />
                          )}
                          {!objectsLoading && bucketName && objectsError && (
                            <TableEmptyState colSpan={6} message={objectsError} />
                          )}
                          {!objectsLoading && bucketName && !objectsError && filteredItems.length === 0 && (
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
              </div>
            </div>
          </div>
        </div>
    </div>
  );
}
