/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import React, { useEffect, useMemo, useRef, useState } from "react";
import axios from "axios";
import PageHeader from "../../components/PageHeader";
import {
  abortMultipartUpload,
  BrowserBucket,
  BrowserObject,
  BrowserObjectVersion,
  completeMultipartUpload,
  copyObject,
  CopyObjectPayload,
  createFolder,
  deleteObjects,
  fetchObjectMetadata,
  getObjectTags,
  initiateMultipartUpload,
  listBrowserBuckets,
  listBrowserObjects,
  listMultipartUploads,
  listObjectVersions,
  ObjectMetadata,
  ObjectTag,
  presignObject,
  presignPart,
  PresignRequest,
  PresignedUrl,
} from "../../api/browser";
import { useS3AccountContext } from "../manager/S3AccountContext";

type SelectionItem = {
  key: string;
  version_id?: string | null;
  is_delete_marker?: boolean;
};

type UploadItem = {
  id: string;
  file: File;
  key: string;
  status: "pending" | "uploading" | "completed" | "error" | "aborted";
  progress: number;
  message?: string;
  uploadId?: string;
  controller?: AbortController;
  parts?: { part_number: number; etag: string }[];
};

const MULTIPART_THRESHOLD = 25 * 1024 * 1024; // 25MB
const PART_SIZE = 8 * 1024 * 1024; // 8MB

function formatBytes(size?: number | null): string {
  if (size == null) return "-";
  if (size === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB", "PB"];
  let value = size;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  const decimals = value >= 10 || unitIndex === 0 ? 0 : 1;
  return `${value.toFixed(decimals)} ${units[unitIndex]}`;
}

function shortName(key: string, prefix: string) {
  if (!prefix) return key;
  if (key.startsWith(prefix)) return key.slice(prefix.length);
  return key;
}

function normalizeEtag(raw?: string | string[] | null): string | undefined {
  if (!raw) return undefined;
  const value = Array.isArray(raw) ? raw[0] : raw;
  return value?.replace(/"/g, "");
}

function makeId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    try {
      return crypto.randomUUID();
    } catch {
      // ignore
    }
  }
  return `upl-${Math.random().toString(36).slice(2, 10)}`;
}

export default function S3BrowserPage() {
  const { accountIdForApi, hasS3AccountContext } = useS3AccountContext();
  const [buckets, setBuckets] = useState<BrowserBucket[]>([]);
  const [bucket, setBucket] = useState<string | null>(null);
  const [loadingBuckets, setLoadingBuckets] = useState(false);
  const [bucketError, setBucketError] = useState<string | null>(null);
  const [prefix, setPrefix] = useState<string>("");
  const [objects, setObjects] = useState<BrowserObject[]>([]);
  const [prefixes, setPrefixes] = useState<string[]>([]);
  const [objectsLoading, setObjectsLoading] = useState(false);
  const [objectsError, setObjectsError] = useState<string | null>(null);
  const [nextToken, setNextToken] = useState<string | null>(null);
  const [isTruncated, setIsTruncated] = useState(false);
  const [versions, setVersions] = useState<BrowserObjectVersion[]>([]);
  const [deleteMarkers, setDeleteMarkers] = useState<BrowserObjectVersion[]>([]);
  const [versionsLoading, setVersionsLoading] = useState(false);
  const [versionsError, setVersionsError] = useState<string | null>(null);
  const [versionKeyMarker, setVersionKeyMarker] = useState<string | null>(null);
  const [versionIdMarker, setVersionIdMarker] = useState<string | null>(null);
  const [showVersions, setShowVersions] = useState(false);
  const [selected, setSelected] = useState<SelectionItem[]>([]);
  const [inspectedKey, setInspectedKey] = useState<string | null>(null);
  const [inspectedVersionId, setInspectedVersionId] = useState<string | null>(null);
  const [metadata, setMetadata] = useState<ObjectMetadata | null>(null);
  const [customMetadata, setCustomMetadata] = useState<ObjectTag[]>([]);
  const [objectTags, setObjectTags] = useState<ObjectTag[]>([]);
  const [metaLoading, setMetaLoading] = useState(false);
  const [metaError, setMetaError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [uploads, setUploads] = useState<UploadItem[]>([]);
  const [dragging, setDragging] = useState(false);
  const [remoteUploads, setRemoteUploads] = useState<{ key: string; upload_id: string }[]>([]);
  const [remoteUploadsLoading, setRemoteUploadsLoading] = useState(false);
  const [remoteUploadsError, setRemoteUploadsError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!hasS3AccountContext) {
      setBuckets([]);
      setBucket(null);
      return;
    }
    const load = async () => {
      setLoadingBuckets(true);
      setBucketError(null);
      try {
        const data = await listBrowserBuckets(accountIdForApi);
        setBuckets(data);
        if (!bucket && data.length > 0) {
          setBucket(data[0].name);
        }
      } catch (err) {
        setBucketError("Unable to list buckets (S3 access needed).");
      } finally {
        setLoadingBuckets(false);
      }
    };
    load();
  }, [accountIdForApi, bucket, hasS3AccountContext]);

  const loadObjects = async (opts?: { append?: boolean; token?: string | null; prefixOverride?: string }) => {
    if (!bucket || !hasS3AccountContext) return;
    if (!opts?.append) {
      setObjectsLoading(true);
      setObjectsError(null);
    }
    try {
      const data = await listBrowserObjects(accountIdForApi, bucket, {
        prefix: opts?.prefixOverride ?? prefix,
        continuationToken: opts?.token ?? undefined,
      });
      setPrefixes(data.prefixes);
      setNextToken(data.next_continuation_token ?? null);
      setIsTruncated(data.is_truncated);
      setObjects((prev) => (opts?.append ? [...prev, ...data.objects] : data.objects));
    } catch (err) {
      setObjectsError("Unable to list objects for this prefix.");
      if (!opts?.append) {
        setObjects([]);
        setPrefixes([]);
      }
    } finally {
      if (!opts?.append) {
        setObjectsLoading(false);
      }
    }
  };

  const loadVersions = async (opts?: { keyMarker?: string | null; versionIdMarker?: string | null; append?: boolean }) => {
    if (!bucket || !showVersions || !hasS3AccountContext) return;
    setVersionsLoading(true);
    setVersionsError(null);
    try {
      const data = await listObjectVersions(accountIdForApi, bucket, {
        prefix,
        keyMarker: opts?.keyMarker ?? versionKeyMarker ?? undefined,
        versionIdMarker: opts?.versionIdMarker ?? versionIdMarker ?? undefined,
      });
      setVersionKeyMarker(data.next_key_marker ?? null);
      setVersionIdMarker(data.next_version_id_marker ?? null);
      setVersions((prev) => (opts?.append ? [...prev, ...data.versions] : data.versions));
      setDeleteMarkers((prev) => (opts?.append ? [...prev, ...data.delete_markers] : data.delete_markers));
    } catch (err) {
      setVersionsError("Unable to list versions (check bucket versioning).");
      if (!opts?.append) {
        setVersions([]);
        setDeleteMarkers([]);
      }
    } finally {
      setVersionsLoading(false);
    }
  };

  useEffect(() => {
    setSelected([]);
    if (bucket && hasS3AccountContext) {
      loadObjects({ prefixOverride: prefix, append: false });
      if (showVersions) {
        loadVersions({ append: false, keyMarker: null, versionIdMarker: null });
      }
    }
  }, [bucket, prefix, hasS3AccountContext]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (showVersions) {
      loadVersions({ append: false, keyMarker: null, versionIdMarker: null });
    }
  }, [showVersions]); // eslint-disable-line react-hooks/exhaustive-deps

  const breadcrumbs = useMemo(() => {
    const parts = prefix.split("/").filter(Boolean);
    const crumbs = [{ label: "root", prefixValue: "" }];
    parts.forEach((part, idx) => {
      const value = `${parts.slice(0, idx + 1).join("/")}/`;
      crumbs.push({ label: part, prefixValue: value });
    });
    return crumbs;
  }, [prefix]);

  const toggleSelection = (item: SelectionItem) => {
    setSelected((prev) => {
      const exists = prev.some((p) => p.key === item.key && (p.version_id || null) === (item.version_id || null));
      if (exists) {
        return prev.filter((p) => !(p.key === item.key && (p.version_id || null) === (item.version_id || null)));
      }
      return [...prev, item];
    });
  };

  const clearSelection = () => setSelected([]);

  const refreshMetadata = async (targetKey: string, versionId?: string | null) => {
    if (!bucket || !hasS3AccountContext) return;
    setMetaLoading(true);
    setMetaError(null);
    try {
      const meta = await fetchObjectMetadata(accountIdForApi, bucket, targetKey, versionId ?? undefined);
      const tags = await getObjectTags(accountIdForApi, bucket, targetKey, versionId ?? undefined);
      setMetadata(meta);
      setCustomMetadata(Object.entries(meta.metadata || {}).map(([k, v]) => ({ key: k, value: v })));
      setObjectTags(tags.tags || []);
    } catch (err) {
      setMetaError("Unable to load metadata/tags for this object.");
      setMetadata(null);
      setCustomMetadata([]);
      setObjectTags([]);
    } finally {
      setMetaLoading(false);
    }
  };

  const handleInspect = (item: SelectionItem) => {
    setInspectedKey(item.key);
    setInspectedVersionId(item.version_id ?? null);
    refreshMetadata(item.key, item.version_id);
  };

  const handleDownload = async () => {
    if (!bucket || selected.length === 0) return;
    try {
      const target = selected[0];
      const presign = await presignObject(accountIdForApi, bucket, {
        key: target.key,
        version_id: target.version_id ?? undefined,
        operation: "get_object",
        expires_in: 900,
      });
      window.open(presign.url, "_blank");
    } catch (err) {
      setStatusMessage("Unable to generate download URL.");
    }
  };

  const handleDelete = async () => {
    if (!bucket || selected.length === 0) return;
    const confirmDelete = window.confirm(`Delete ${selected.length} item(s)?`);
    if (!confirmDelete) return;
    try {
      await deleteObjects(accountIdForApi, bucket, selected.map((s) => ({ key: s.key, version_id: s.version_id })));
      setStatusMessage(`Deleted ${selected.length} item(s)`);
      clearSelection();
      await loadObjects({ prefixOverride: prefix });
      if (showVersions) {
        await loadVersions({ append: false, keyMarker: null, versionIdMarker: null });
      }
    } catch (err) {
      setStatusMessage("Deletion failed (check permissions).");
    }
  };

  const handleCopyOrMove = async (mode: "copy" | "move") => {
    if (!bucket || selected.length === 0) return;
    if (selected.length > 1) {
      alert("Copy/Move is limited to one object at a time for now.");
      return;
    }
    const target = selected[0];
    const suggested = target.key.includes("/") ? target.key.replace(/[^/]+$/, "") : "";
    const destination = window.prompt(`Destination key (same bucket)`, `${suggested}`);
    if (!destination) return;
    const destKey = destination.endsWith("/") ? `${destination}${target.key.split("/").pop()}` : destination;
    const payload: CopyObjectPayload = {
      source_key: target.key,
      destination_key: destKey,
      source_version_id: target.version_id ?? undefined,
      move: mode === "move",
    };
    try {
      await copyObject(accountIdForApi, bucket, payload);
      setStatusMessage(`${mode === "move" ? "Moved" : "Copied"} ${target.key} to ${destKey}`);
      clearSelection();
      await loadObjects({ prefixOverride: prefix });
      if (showVersions) {
        await loadVersions({ append: false, keyMarker: null, versionIdMarker: null });
      }
    } catch (err) {
      setStatusMessage(`Unable to ${mode} the object.`);
    }
  };

  const handleNewFolder = async () => {
    if (!bucket) return;
    const name = window.prompt("Folder name (no trailing slash):");
    if (!name) return;
    const prefixValue = `${prefix}${name}`.replace(/\/+$/, "");
    try {
      await createFolder(accountIdForApi, bucket, `${prefixValue}/`);
      setStatusMessage(`Folder ${name} created`);
      await loadObjects({ prefixOverride: prefix });
    } catch (err) {
      setStatusMessage("Unable to create folder.");
    }
  };

  const handleRestoreVersion = async (item: BrowserObjectVersion) => {
    if (!bucket || !item.version_id) return;
    try {
      await copyObject(accountIdForApi, bucket, {
        source_key: item.key,
        source_version_id: item.version_id,
        destination_key: item.key,
        replace_metadata: false,
        move: false,
      });
      setStatusMessage(`Restored version ${item.version_id}`);
      await loadObjects({ prefixOverride: prefix });
      await loadVersions({ append: false, keyMarker: null, versionIdMarker: null });
    } catch (err) {
      setStatusMessage("Unable to restore version.");
    }
  };

  const handleSaveMetadata = async () => {
    if (!bucket || !metadata) return;
    const cleanedMeta: Record<string, string> = {};
    customMetadata
      .filter((item) => (item.key || "").trim())
      .forEach((item) => {
        cleanedMeta[item.key] = item.value ?? "";
      });
    try {
      await copyObject(accountIdForApi, bucket, {
        source_key: metadata.key,
        destination_key: metadata.key,
        replace_metadata: true,
        metadata: cleanedMeta,
        replace_tags: true,
        tags: objectTags,
      });
      setStatusMessage("Metadata/tags updated");
      await refreshMetadata(metadata.key, inspectedVersionId);
    } catch (err) {
      setStatusMessage("Unable to update metadata/tags.");
    }
  };

  const handleFiles = (files: File[]) => {
    if (!bucket || files.length === 0) return;
    const items: UploadItem[] = files.map((file) => {
      const relative = (file as any).webkitRelativePath as string | undefined;
      const key = `${prefix}${relative && relative.length > 0 ? relative : file.name}`;
      return {
        id: makeId(),
        file,
        key,
        status: "pending",
        progress: 0,
      };
    });
    setUploads((prev) => [...items, ...prev]);
    items.forEach((item) => startUpload(item));
  };

  const startUpload = async (item: UploadItem) => {
    if (!bucket) return;
    setUploads((prev) => prev.map((u) => (u.id === item.id ? { ...u, status: "uploading", progress: 0 } : u)));
    if (item.file.size >= MULTIPART_THRESHOLD) {
      await uploadMultipart(item);
    } else {
      await uploadSimple(item);
    }
  };

  const uploadSimple = async (item: UploadItem) => {
    if (!bucket) return;
    const controller = new AbortController();
    setUploads((prev) => prev.map((u) => (u.id === item.id ? { ...u, controller } : u)));
    try {
      const presign: PresignedUrl = await presignObject(accountIdForApi, bucket, {
        key: item.key,
        operation: "put_object",
        content_type: item.file.type || undefined,
        expires_in: 1800,
      } as PresignRequest);
      await axios.put(presign.url, item.file, {
        headers: { ...(presign.headers || {}), "Content-Type": item.file.type || "application/octet-stream" },
        signal: controller.signal,
        onUploadProgress: (evt) => {
          const total = evt.total ?? item.file.size;
          const percent = Math.round((evt.loaded / total) * 100);
          setUploads((prev) => prev.map((u) => (u.id === item.id ? { ...u, progress: percent } : u)));
        },
      });
      setUploads((prev) => prev.map((u) => (u.id === item.id ? { ...u, status: "completed", progress: 100 } : u)));
      await loadObjects({ prefixOverride: prefix });
    } catch (err) {
      const aborted = axios.isCancel(err) || (err instanceof DOMException && err.name === "AbortError");
      setUploads((prev) =>
        prev.map((u) =>
          u.id === item.id
            ? { ...u, status: aborted ? "aborted" : "error", message: aborted ? "Cancelled" : "Upload failed" }
            : u
        )
      );
    }
  };

  const uploadMultipart = async (item: UploadItem) => {
    if (!bucket) return;
    const controller = new AbortController();
    setUploads((prev) => prev.map((u) => (u.id === item.id ? { ...u, controller, message: "Starting multipart..." } : u)));
    let uploadId: string | null = null;
    try {
      const init = await initiateMultipartUpload(accountIdForApi, bucket, {
        key: item.key,
        content_type: item.file.type || undefined,
      });
      uploadId = init.upload_id;
      setUploads((prev) => prev.map((u) => (u.id === item.id ? { ...u, uploadId, message: "Uploading parts..." } : u)));
      const parts: { part_number: number; etag: string }[] = [];
      const totalParts = Math.ceil(item.file.size / PART_SIZE);
      for (let partNumber = 1; partNumber <= totalParts; partNumber += 1) {
        const start = (partNumber - 1) * PART_SIZE;
        const end = Math.min(start + PART_SIZE, item.file.size);
        const blob = item.file.slice(start, end);
        const presignedPart = await presignPart(accountIdForApi, bucket, uploadId, {
          key: item.key,
          part_number: partNumber,
          expires_in: 1800,
        });
        const response = await axios.put(presignedPart.url, blob, {
          headers: presignedPart.headers || {},
          signal: controller.signal,
          onUploadProgress: (evt) => {
            const chunkProgress = evt.total ? evt.loaded / evt.total : evt.loaded / blob.size;
            const overall = ((partNumber - 1) / totalParts + chunkProgress / totalParts) * 100;
            setUploads((prev) => prev.map((u) => (u.id === item.id ? { ...u, progress: Math.round(overall) } : u)));
          },
        });
        const etag = normalizeEtag(response.headers?.etag || response.headers?.ETag || response.headers?.ETAG) || "";
        parts.push({ part_number: partNumber, etag });
      }
      setUploads((prev) => prev.map((u) => (u.id === item.id ? { ...u, progress: 95, message: "Finalizing..." } : u)));
      await completeMultipartUpload(accountIdForApi, bucket, uploadId, item.key, { parts });
      setUploads((prev) =>
        prev.map((u) => (u.id === item.id ? { ...u, status: "completed", progress: 100, parts, message: undefined } : u))
      );
      await loadObjects({ prefixOverride: prefix });
    } catch (err) {
      const aborted = axios.isCancel(err) || (err instanceof DOMException && err.name === "AbortError");
      setUploads((prev) =>
        prev.map((u) =>
          u.id === item.id
            ? {
                ...u,
                status: aborted ? "aborted" : "error",
                message: aborted ? "Cancelled" : "Multipart upload failed",
              }
            : u
        )
      );
      if (uploadId && !aborted) {
        try {
          await abortMultipartUpload(accountIdForApi, bucket, uploadId, item.key);
        } catch {
          // ignore abort failures
        }
      }
    }
  };

  const handleCancelUpload = async (uploadId: string) => {
    const target = uploads.find((u) => u.id === uploadId);
    if (!target) return;
    if (target.controller) {
      target.controller.abort();
    }
    if (target.uploadId && bucket) {
      try {
        await abortMultipartUpload(accountIdForApi, bucket, target.uploadId, target.key);
      } catch {
        // ignore abort error
      }
    }
    setUploads((prev) => prev.map((u) => (u.id === uploadId ? { ...u, status: "aborted", message: "Cancelled" } : u)));
  };

  const handleDragOver = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(true);
  };

  const handleDragLeave = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
  };

  const handleDrop = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    const files = Array.from(event.dataTransfer.files || []);
    handleFiles(files);
  };

  const handleInputChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files ? Array.from(event.target.files) : [];
    handleFiles(files);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const loadRemoteMultipart = async () => {
    if (!bucket) return;
    setRemoteUploadsLoading(true);
    setRemoteUploadsError(null);
    try {
      const data = await listMultipartUploads(accountIdForApi, bucket, { prefix });
      const normalized = (data.uploads || [])
        .filter((u) => u.key && u.upload_id)
        .map((u) => ({ key: u.key as string, upload_id: u.upload_id as string }));
      setRemoteUploads(normalized);
    } catch (err) {
      setRemoteUploadsError("Unable to list multipart uploads.");
      setRemoteUploads([]);
    } finally {
      setRemoteUploadsLoading(false);
    }
  };

  useEffect(() => {
    loadRemoteMultipart();
  }, [bucket, prefix]); // eslint-disable-line react-hooks/exhaustive-deps

  const currentRows = useMemo(() => {
    const normalizedPrefix = prefix.endsWith("/") || prefix === "" ? prefix : `${prefix}/`;
    const prefixRows = prefixes.map((p) => ({
      type: "prefix",
      key: p,
      name: shortName(p, normalizedPrefix) || p,
    }));
    const objectRows = objects.map((obj) => ({
      type: "object",
      key: obj.key,
      name: shortName(obj.key, normalizedPrefix),
      object: obj,
    }));
    return [...prefixRows, ...objectRows];
  }, [objects, prefix, prefixes]);

  const versionRows = useMemo(() => {
    const entries = [...versions, ...deleteMarkers].map((v) => ({
      ...v,
      is_delete_marker: v.is_delete_marker || false,
    }));
    return entries.sort((a, b) => {
      const dateA = a.last_modified ? new Date(a.last_modified).getTime() : 0;
      const dateB = b.last_modified ? new Date(b.last_modified).getTime() : 0;
      return dateB - dateA;
    });
  }, [deleteMarkers, versions]);

  return (
    <div className="space-y-4">
      <PageHeader
        title="S3 Browser"
        description="Explore buckets and objects via signed S3 calls. Upload directly to S3 with drag-and-drop and manage versions, tags, and metadata."
        actions={
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 shadow-sm transition hover:border-primary hover:text-primary dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
              onClick={handleNewFolder}
              disabled={!bucket}
            >
              New folder
            </button>
            <button
              type="button"
              className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 shadow-sm transition hover:border-primary hover:text-primary dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
              onClick={() => fileInputRef.current?.click()}
              disabled={!bucket}
            >
              Upload
            </button>
            <button
              type="button"
              className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 shadow-sm transition hover:border-primary hover:text-primary dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
              onClick={handleDownload}
              disabled={!bucket || selected.length === 0}
            >
              Download
            </button>
            <button
              type="button"
              className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 shadow-sm transition hover:border-primary hover:text-primary dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
              onClick={() => handleCopyOrMove("copy")}
              disabled={!bucket || selected.length === 0}
            >
              Copy
            </button>
            <button
              type="button"
              className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 shadow-sm transition hover:border-primary hover:text-primary dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
              onClick={() => handleCopyOrMove("move")}
              disabled={!bucket || selected.length === 0}
            >
              Move
            </button>
            <button
              type="button"
              className="rounded-lg border border-rose-200 bg-white px-3 py-2 text-sm font-semibold text-rose-700 shadow-sm transition hover:border-rose-400 hover:text-rose-800 dark:border-rose-900 dark:bg-rose-950/20 dark:text-rose-100"
              onClick={handleDelete}
              disabled={!bucket || selected.length === 0}
            >
              Delete
            </button>
          </div>
        }
      />

      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-slate-600 dark:text-slate-200">Bucket</span>
          <select
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 shadow-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
            value={bucket ?? ""}
            onChange={(e) => setBucket(e.target.value || null)}
            disabled={loadingBuckets || !hasS3AccountContext}
          >
            {!bucket && <option value="">Select a bucket</option>}
            {buckets.map((b) => (
              <option key={b.name} value={b.name}>
                {b.name}
              </option>
            ))}
          </select>
          {bucketError && <span className="text-sm text-rose-600 dark:text-rose-300">{bucketError}</span>}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-slate-600 dark:text-slate-200">Prefix</span>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            {breadcrumbs.map((crumb, idx) => (
              <div key={crumb.prefixValue} className="flex items-center gap-2">
                {idx > 0 && <span className="text-slate-400">/</span>}
                <button
                  type="button"
                  className="rounded px-2 py-1 font-semibold text-primary transition hover:bg-primary/10"
                  onClick={() => {
                    setPrefix(crumb.prefixValue);
                    setNextToken(null);
                    setIsTruncated(false);
                  }}
                >
                  {crumb.label || "/"}
                </button>
              </div>
            ))}
          </div>
        </div>
        <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
          <input
            type="checkbox"
            checked={showVersions}
            onChange={(e) => setShowVersions(e.target.checked)}
            className="h-4 w-4 rounded border-slate-300 text-primary focus:ring-primary"
          />
          Show versions
        </label>
        <button
          type="button"
          className="ml-auto rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 shadow-sm transition hover:border-primary hover:text-primary dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
          onClick={() => {
            loadObjects({ prefixOverride: prefix, append: false });
            if (showVersions) loadVersions({ append: false, keyMarker: null, versionIdMarker: null });
          }}
        >
          Refresh
        </button>
      </div>

      <div
        className={`rounded-xl border border-dashed border-slate-300 bg-slate-50/70 p-4 shadow-inner transition dark:border-slate-700 dark:bg-slate-900/60 ${dragging ? "border-primary bg-primary/5" : ""}`}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        <div className="flex items-center justify-between gap-4">
          <div>
            <div className="text-sm font-semibold text-slate-700 dark:text-slate-100">Drag & drop files to upload</div>
            <div className="text-xs text-slate-500 dark:text-slate-300">
              Files are uploaded directly to S3 with signed PUT/Multipart URLs.
            </div>
          </div>
          <div className="flex items-center gap-3">
            <input
              ref={fileInputRef}
              type="file"
              multiple
              onChange={handleInputChange}
              className="hidden"
            />
            <button
              type="button"
              className="rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-primary/90"
              onClick={() => fileInputRef.current?.click()}
              disabled={!bucket}
            >
              Select files
            </button>
          </div>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-700 dark:border-slate-800 dark:bg-slate-900/80 dark:text-slate-100">
              <div>
                Objects {prefix ? `· ${prefix}` : ""}
                {objectsError && <span className="ml-2 text-xs font-normal text-rose-500">{objectsError}</span>}
              </div>
              {objectsLoading && <span className="text-xs text-slate-500">Loading...</span>}
            </div>
            <div className="divide-y divide-slate-100 dark:divide-slate-800">
              {currentRows.length === 0 && !objectsLoading && (
                <div className="px-4 py-6 text-sm text-slate-500 dark:text-slate-300">No objects in this prefix.</div>
              )}
              {currentRows.map((row) =>
                row.type === "prefix" ? (
                  <div
                    key={row.key}
                    className="flex cursor-pointer items-center gap-3 px-4 py-3 text-sm transition hover:bg-primary/5 dark:hover:bg-primary/10"
                    onClick={() => {
                      setPrefix(row.key);
                      setNextToken(null);
                      setIsTruncated(false);
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={selected.some((s) => s.key === row.key)}
                      onChange={() => toggleSelection({ key: row.key })}
                      className="h-4 w-4 rounded border-slate-300 text-primary focus:ring-primary"
                      onClick={(e) => e.stopPropagation()}
                    />
                    <span className="font-semibold text-primary">📁 {row.name}</span>
                  </div>
                ) : (
                  <div
                    key={row.key}
                    className="flex items-center gap-3 px-4 py-3 text-sm transition hover:bg-primary/5 dark:hover:bg-primary/10"
                  >
                    <input
                      type="checkbox"
                      checked={selected.some((s) => s.key === row.key)}
                      onChange={() => toggleSelection({ key: row.key })}
                      className="h-4 w-4 rounded border-slate-300 text-primary focus:ring-primary"
                    />
                    <div className="min-w-0 flex-1">
                      <div
                        className="cursor-pointer truncate font-semibold text-slate-800 hover:text-primary dark:text-slate-100"
                        onClick={() => handleInspect({ key: row.key })}
                      >
                        {row.name}
                      </div>
                      <div className="flex flex-wrap gap-3 text-xs text-slate-500 dark:text-slate-300">
                        <span>{formatBytes(row.object.size)}</span>
                        {row.object.last_modified && <span>{new Date(row.object.last_modified).toLocaleString()}</span>}
                        {row.object.storage_class && <span>{row.object.storage_class}</span>}
                        {row.object.etag && <span>ETag {row.object.etag}</span>}
                      </div>
                    </div>
                  </div>
                )
              )}
            </div>
            {isTruncated && nextToken && (
              <div className="border-t border-slate-200 bg-slate-50 px-4 py-3 text-right dark:border-slate-800 dark:bg-slate-900/70">
                <button
                  type="button"
                  className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 shadow-sm transition hover:border-primary hover:text-primary dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                  onClick={() => loadObjects({ append: true, token: nextToken })}
                >
                  Load more
                </button>
              </div>
            )}
          </div>

          {showVersions && (
            <div className="mt-4 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
              <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-700 dark:border-slate-800 dark:bg-slate-900/80 dark:text-slate-100">
                <div>Versions</div>
                {versionsLoading && <span className="text-xs text-slate-500">Loading...</span>}
              </div>
              {versionsError && <div className="px-4 py-2 text-sm text-rose-500">{versionsError}</div>}
              <div className="divide-y divide-slate-100 dark:divide-slate-800">
                {versionRows.length === 0 && !versionsLoading && (
                  <div className="px-4 py-4 text-sm text-slate-500 dark:text-slate-300">No versions found.</div>
                )}
                {versionRows.map((ver) => (
                  <div key={`${ver.key}-${ver.version_id}-${ver.is_delete_marker}`} className="flex items-center gap-3 px-4 py-3 text-sm">
                    <input
                      type="checkbox"
                      checked={selected.some((s) => s.key === ver.key && (s.version_id || null) === (ver.version_id || null))}
                      onChange={() => toggleSelection({ key: ver.key, version_id: ver.version_id, is_delete_marker: ver.is_delete_marker })}
                      className="h-4 w-4 rounded border-slate-300 text-primary focus:ring-primary"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="truncate font-semibold text-slate-800 dark:text-slate-100">{ver.key}</span>
                        {ver.is_delete_marker && (
                          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-700 dark:bg-amber-900/40 dark:text-amber-100">
                            delete marker
                          </span>
                        )}
                        {ver.is_latest && (
                          <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-100">
                            latest
                          </span>
                        )}
                      </div>
                      <div className="flex flex-wrap gap-3 text-xs text-slate-500 dark:text-slate-300">
                        {ver.version_id && <span>v: {ver.version_id}</span>}
                        {ver.last_modified && <span>{new Date(ver.last_modified).toLocaleString()}</span>}
                        {ver.size != null && <span>{formatBytes(ver.size)}</span>}
                        {ver.etag && <span>ETag {ver.etag}</span>}
                      </div>
                    </div>
                    {!ver.is_delete_marker && (
                      <button
                        type="button"
                        className="rounded border border-slate-200 px-2 py-1 text-xs font-semibold text-slate-700 transition hover:border-primary hover:text-primary dark:border-slate-700 dark:text-slate-100"
                        onClick={() => handleRestoreVersion(ver)}
                      >
                        Restore
                      </button>
                    )}
                  </div>
                ))}
              </div>
              {(versionKeyMarker || versionIdMarker) && (
                <div className="border-t border-slate-200 bg-slate-50 px-4 py-3 text-right dark:border-slate-800 dark:bg-slate-900/70">
                  <button
                    type="button"
                    className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 shadow-sm transition hover:border-primary hover:text-primary dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                    onClick={() => loadVersions({ append: true })}
                  >
                    Load more versions
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="space-y-4">
          <div className="rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <div className="border-b border-slate-200 bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-700 dark:border-slate-800 dark:bg-slate-900/80 dark:text-slate-100">
              Inspector
            </div>
            {!inspectedKey && <div className="px-4 py-4 text-sm text-slate-500 dark:text-slate-300">Select an object to view metadata.</div>}
            {inspectedKey && (
              <div className="space-y-3 px-4 py-4 text-sm">
                <div className="font-semibold text-slate-800 dark:text-slate-100">{inspectedKey}</div>
                {metaLoading && <div className="text-xs text-slate-500">Loading metadata...</div>}
                {metaError && <div className="text-xs text-rose-500">{metaError}</div>}
                {metadata && (
                  <>
                    <div className="grid grid-cols-2 gap-2 text-xs text-slate-600 dark:text-slate-200">
                      <span className="font-semibold">Size</span>
                      <span>{formatBytes(metadata.size)}</span>
                      <span className="font-semibold">Last modified</span>
                      <span>{metadata.last_modified ? new Date(metadata.last_modified).toLocaleString() : "-"}</span>
                      <span className="font-semibold">ETag</span>
                      <span className="break-all">{metadata.etag || "-"}</span>
                      <span className="font-semibold">Storage class</span>
                      <span>{metadata.storage_class || "-"}</span>
                      <span className="font-semibold">Content-Type</span>
                      <span>{metadata.content_type || "-"}</span>
                      {inspectedVersionId && (
                        <>
                          <span className="font-semibold">Version</span>
                          <span>{inspectedVersionId}</span>
                        </>
                      )}
                    </div>

                    <div className="pt-2">
                      <div className="mb-1 text-xs font-semibold text-slate-700 dark:text-slate-100">Metadata (x-amz-meta-*)</div>
                      <div className="space-y-2">
                        {customMetadata.map((item, idx) => (
                          <div key={`${item.key}-${idx}`} className="flex gap-2">
                            <input
                              type="text"
                              value={item.key}
                              onChange={(e) =>
                                setCustomMetadata((prev) => prev.map((m, i) => (i === idx ? { ...m, key: e.target.value } : m)))
                              }
                              placeholder="key"
                              className="w-1/3 rounded border border-slate-300 px-2 py-1 text-xs dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                            />
                            <input
                              type="text"
                              value={item.value}
                              onChange={(e) =>
                                setCustomMetadata((prev) => prev.map((m, i) => (i === idx ? { ...m, value: e.target.value } : m)))
                              }
                              placeholder="value"
                              className="w-2/3 rounded border border-slate-300 px-2 py-1 text-xs dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                            />
                            <button
                              type="button"
                              className="rounded border border-slate-200 px-2 py-1 text-xs font-semibold text-slate-600 transition hover:border-rose-300 hover:text-rose-500 dark:border-slate-700 dark:text-slate-200"
                              onClick={() => setCustomMetadata((prev) => prev.filter((_, i) => i !== idx))}
                            >
                              ✕
                            </button>
                          </div>
                        ))}
                        <button
                          type="button"
                          className="text-xs font-semibold text-primary hover:underline"
                          onClick={() => setCustomMetadata((prev) => [...prev, { key: "", value: "" }])}
                        >
                          + Add metadata
                        </button>
                      </div>
                    </div>

                    <div className="pt-2">
                      <div className="mb-1 text-xs font-semibold text-slate-700 dark:text-slate-100">Tags</div>
                      <div className="space-y-2">
                        {objectTags.map((tag, idx) => (
                          <div key={`${tag.key}-${idx}`} className="flex gap-2">
                            <input
                              type="text"
                              value={tag.key}
                              onChange={(e) =>
                                setObjectTags((prev) => prev.map((t, i) => (i === idx ? { ...t, key: e.target.value } : t)))
                              }
                              placeholder="key"
                              className="w-1/3 rounded border border-slate-300 px-2 py-1 text-xs dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                            />
                            <input
                              type="text"
                              value={tag.value}
                              onChange={(e) =>
                                setObjectTags((prev) => prev.map((t, i) => (i === idx ? { ...t, value: e.target.value } : t)))
                              }
                              placeholder="value"
                              className="w-2/3 rounded border border-slate-300 px-2 py-1 text-xs dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                            />
                            <button
                              type="button"
                              className="rounded border border-slate-200 px-2 py-1 text-xs font-semibold text-slate-600 transition hover:border-rose-300 hover:text-rose-500 dark:border-slate-700 dark:text-slate-200"
                              onClick={() => setObjectTags((prev) => prev.filter((_, i) => i !== idx))}
                            >
                              ✕
                            </button>
                          </div>
                        ))}
                        <button
                          type="button"
                          className="text-xs font-semibold text-primary hover:underline"
                          onClick={() => setObjectTags((prev) => [...prev, { key: "", value: "" }])}
                        >
                          + Add tag
                        </button>
                      </div>
                    </div>

                    <div className="pt-2">
                      <button
                        type="button"
                        className="rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-white shadow-sm transition hover:bg-primary/90"
                        onClick={handleSaveMetadata}
                      >
                        Save metadata & tags
                      </button>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>

          <div className="rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-700 dark:border-slate-800 dark:bg-slate-900/80 dark:text-slate-100">
              <span>Upload queue</span>
              <span className="text-xs font-normal text-slate-500 dark:text-slate-300">PUT / multipart direct to S3</span>
            </div>
            {uploads.length === 0 && <div className="px-4 py-4 text-sm text-slate-500 dark:text-slate-300">No uploads queued.</div>}
            <div className="divide-y divide-slate-100 dark:divide-slate-800">
              {uploads.map((u) => (
                <div key={u.id} className="px-4 py-3 text-xs text-slate-700 dark:text-slate-200">
                  <div className="flex items-center justify-between">
                    <div className="min-w-0">
                      <div className="truncate font-semibold">{u.key}</div>
                      <div className="text-slate-500">{formatBytes(u.file.size)}</div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span
                        className={`rounded-full px-2 py-1 text-[11px] font-semibold ${
                          u.status === "completed"
                            ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-100"
                            : u.status === "error"
                              ? "bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-100"
                              : u.status === "aborted"
                                ? "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-100"
                                : "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200"
                        }`}
                      >
                        {u.status}
                      </span>
                      {(u.status === "uploading" || u.status === "pending") && (
                        <button
                          type="button"
                          className="rounded border border-slate-200 px-2 py-1 text-[11px] font-semibold text-slate-700 transition hover:border-rose-300 hover:text-rose-500 dark:border-slate-700 dark:text-slate-200"
                          onClick={() => handleCancelUpload(u.id)}
                        >
                          Cancel
                        </button>
                      )}
                    </div>
                  </div>
                  <div className="mt-2 h-2 rounded-full bg-slate-100 dark:bg-slate-800">
                    <div
                      className={`h-2 rounded-full ${u.status === "error" ? "bg-rose-500" : "bg-primary"}`}
                      style={{ width: `${u.progress}%` }}
                    />
                  </div>
                  {u.message && <div className="mt-1 text-[11px] text-slate-500 dark:text-slate-300">{u.message}</div>}
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-700 dark:border-slate-800 dark:bg-slate-900/80 dark:text-slate-100">
              <span>Ongoing multipart uploads</span>
              <button
                type="button"
                className="text-xs font-semibold text-primary hover:underline"
                onClick={() => loadRemoteMultipart()}
              >
                Refresh
              </button>
            </div>
            {remoteUploadsLoading && <div className="px-4 py-3 text-xs text-slate-500">Loading...</div>}
            {remoteUploadsError && <div className="px-4 py-3 text-xs text-rose-500">{remoteUploadsError}</div>}
            {!remoteUploadsLoading && remoteUploads.length === 0 && (
              <div className="px-4 py-3 text-sm text-slate-500 dark:text-slate-300">No in-flight uploads.</div>
            )}
            <div className="divide-y divide-slate-100 dark:divide-slate-800">
              {remoteUploads.map((u) => (
                <div key={`${u.key}-${u.upload_id}`} className="flex items-center justify-between px-4 py-3 text-xs text-slate-700 dark:text-slate-200">
                  <div className="min-w-0">
                    <div className="truncate font-semibold">{u.key}</div>
                    <div className="text-slate-500">UploadId: {u.upload_id}</div>
                  </div>
                  <button
                    type="button"
                    className="rounded border border-slate-200 px-2 py-1 text-[11px] font-semibold text-slate-700 transition hover:border-rose-300 hover:text-rose-500 dark:border-slate-700 dark:text-slate-200"
                    onClick={() => abortMultipartUpload(accountIdForApi, bucket!, u.upload_id, u.key).then(loadRemoteMultipart)}
                  >
                    Abort
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {statusMessage && (
        <div className="rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700 shadow-sm dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200">
          {statusMessage}
        </div>
      )}
    </div>
  );
}
