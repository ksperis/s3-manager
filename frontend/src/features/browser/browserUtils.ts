/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import axios from "axios";
import type { BrowserObjectVersion } from "../../api/browser";
import type { BrowserItem, TreeNode, UploadCandidate, WebkitEntry } from "./browserTypes";

export const clampParallelism = (value: number, fallback: number) => {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(20, Math.max(1, Math.floor(value)));
};

export const formatDateTime = (value?: string | null): string => {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const pad = (num: number) => `${num}`.padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(
    date.getMinutes()
  )}`;
};

export const formatLocalDateTime = (value?: string | Date | null) => {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (num: number) => `${num}`.padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(
    date.getMinutes()
  )}`;
};

export const toIsoString = (value: string) => {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString();
};

export const formatBadgeCount = (count: number) => (count > 99 ? "99+" : `${count}`);

export const normalizePrefix = (value: string) => {
  if (!value) return "";
  return value.endsWith("/") ? value : `${value}/`;
};

export const shortName = (key: string, basePrefix: string) => {
  if (!basePrefix) return key;
  if (key.startsWith(basePrefix)) return key.slice(basePrefix.length);
  return key;
};

export const buildTreeNodes = (prefixes: string[], parentPrefix: string): TreeNode[] => {
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

export const updateTreeNodes = (
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

export const findTreeNodeByPrefix = (nodes: TreeNode[], targetPrefix: string): TreeNode | null => {
  for (const node of nodes) {
    if (node.prefix === targetPrefix) return node;
    if (node.children.length > 0) {
      const match = findTreeNodeByPrefix(node.children, targetPrefix);
      if (match) return match;
    }
  }
  return null;
};

export const makeId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

export const isLikelyCorsError = (error: unknown) => {
  if (!axios.isAxiosError(error)) return false;
  if (!error.response) return true;
  return error.code === "ERR_NETWORK" || error.message === "Network Error";
};

export const isAbortError = (error: unknown) => {
  if (axios.isAxiosError(error)) {
    return error.code === "ERR_CANCELED" || error.name === "CanceledError";
  }
  return error instanceof DOMException && error.name === "AbortError";
};

export const normalizeEtag = (raw?: string | string[] | null): string | undefined => {
  if (!raw) return undefined;
  const value = Array.isArray(raw) ? raw[0] : raw;
  return value?.replace(/"/g, "");
};

export const chunkItems = <T,>(items: T[], size: number): T[][] => {
  if (size <= 0) return [items];
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
};

export const parseKeyValueLines = (value: string) => {
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const equalsIndex = line.indexOf("=");
      const colonIndex = line.indexOf(":");
      const splitIndex = equalsIndex === -1 ? colonIndex : equalsIndex;
      if (splitIndex === -1) return null;
      const key = line.slice(0, splitIndex).trim();
      const val = line.slice(splitIndex + 1).trim();
      if (!key) return null;
      return { key, value: val };
    })
    .filter((entry): entry is { key: string; value: string } => Boolean(entry));
};

export const pairsToRecord = (items: { key: string; value: string }[]) =>
  items.reduce<Record<string, string>>((acc, item) => {
    acc[item.key] = item.value;
    return acc;
  }, {});

export const normalizeUploadPath = (value: string) => value.replace(/\\/g, "/").replace(/^\/+/, "");

export const extractRelativePath = (file: File) => {
  const relative = (file as { webkitRelativePath?: string }).webkitRelativePath;
  return relative && relative.length > 0 ? relative : file.name;
};

export const buildUploadCandidates = (files: File[]): UploadCandidate[] =>
  files.map((file) => ({ file, relativePath: extractRelativePath(file) }));

export const buildUploadGrouping = (relativePath: string, batchId: string) => {
  const normalized = normalizeUploadPath(relativePath);
  const parts = normalized.split("/").filter(Boolean);
  if (parts.length > 1) {
    return {
      groupId: `${batchId}:${parts[0]}`,
      groupLabel: parts[0],
      groupKind: "folder" as const,
      itemLabel: parts.slice(1).join("/"),
    };
  }
  return {
    groupId: `${batchId}:files`,
    groupLabel: "Files",
    groupKind: "files" as const,
    itemLabel: normalized || "Untitled",
  };
};

export const getWebkitEntry = (item: DataTransferItem): WebkitEntry | null => {
  const cast = item as DataTransferItem & { webkitGetAsEntry?: () => WebkitEntry | null };
  return cast.webkitGetAsEntry ? cast.webkitGetAsEntry() : null;
};

export const readDirectoryEntries = (reader: {
  readEntries: (success: (entries: WebkitEntry[]) => void, error?: (error: unknown) => void) => void;
}) =>
  new Promise<WebkitEntry[]>((resolve, reject) => {
    reader.readEntries(resolve, reject);
  });

export const walkEntry = async (entry: WebkitEntry, parentPath: string): Promise<UploadCandidate[]> => {
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

export const collectDroppedFiles = async (dataTransfer: DataTransfer): Promise<UploadCandidate[]> => {
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

export const getExtension = (name: string) => {
  const idx = name.lastIndexOf(".");
  if (idx === -1) return "";
  return name.slice(idx + 1).toLowerCase();
};

export const isImageFile = (name: string) => {
  const ext = getExtension(name);
  return ["png", "jpg", "jpeg", "gif", "svg", "webp"].includes(ext);
};

export const isVideoFile = (name: string) => {
  const ext = getExtension(name);
  return ["mp4", "webm", "ogg", "mov", "m4v"].includes(ext);
};

export const isAudioFile = (name: string) => {
  const ext = getExtension(name);
  return ["mp3", "wav", "ogg", "m4a", "flac"].includes(ext);
};

export const isPdfFile = (name: string) => getExtension(name) === "pdf";

export const isTextFile = (name: string) => {
  const ext = getExtension(name);
  return ["txt", "md", "markdown", "csv", "json", "yml", "yaml", "xml", "html", "css", "js", "ts", "log"].includes(ext);
};

export const previewKindForItem = (item: BrowserItem, contentType?: string | null) => {
  const normalized = (contentType ?? "").toLowerCase();
  if (normalized.startsWith("image/")) return "image";
  if (normalized.startsWith("video/")) return "video";
  if (normalized.startsWith("audio/")) return "audio";
  if (normalized.includes("pdf")) return "pdf";
  if (normalized.startsWith("text/") || normalized.includes("json") || normalized.includes("xml")) return "text";
  if (isImageFile(item.name)) return "image";
  if (isVideoFile(item.name)) return "video";
  if (isAudioFile(item.name)) return "audio";
  if (isPdfFile(item.name)) return "pdf";
  if (isTextFile(item.name)) return "text";
  return "generic";
};

export const previewLabelForItem = (item: BrowserItem) => {
  if (item.type === "folder") return "FOLDER";
  const ext = getExtension(item.name);
  if (!ext) return "FILE";
  return ext.toUpperCase();
};

export const buildVersionRows = (versions: BrowserObjectVersion[], deleteMarkers: BrowserObjectVersion[]) => {
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

export const getSelectionInfo = (items: BrowserItem[]) => {
  const files = items.filter((item) => item.type === "file");
  const folders = items.filter((item) => item.type === "folder");
  const isSingle = items.length === 1;
  const primary = isSingle ? items[0] : null;
  const hasFolder = folders.length > 0;
  const hasFile = files.length > 0;
  return {
    items,
    files,
    folders,
    isSingle,
    primary,
    hasFolder,
    hasFile,
    canDownloadFiles: hasFile && !hasFolder,
    canDownloadFolder: isSingle && primary?.type === "folder",
    canOpen: primary?.type === "folder",
    canCopyUrl: primary?.type === "file",
    canAdvanced: primary?.type === "file",
  };
};
