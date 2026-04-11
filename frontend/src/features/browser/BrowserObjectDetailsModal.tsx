/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useEffect, useMemo, useRef, useState } from "react";
import Modal from "../../components/Modal";
import { extractApiError } from "../../utils/apiError";
import {
  fetchObjectMetadata,
  getObjectLegalHold,
  getObjectRetention,
  getObjectTags,
  listObjectVersions,
  presignObject,
  proxyDownload,
  restoreObject,
  updateObjectAcl,
  updateObjectLegalHold,
  updateObjectMetadata,
  updateObjectRetention,
  updateObjectTags,
  type BrowserObjectVersion,
  type ObjectLegalHold,
  type ObjectMetadata,
  type ObjectMetadataUpdate,
  type ObjectRetention,
  type ObjectRestoreRequest,
  type ObjectTag,
  type ObjectTags,
  type PresignedUrl,
  type PresignRequest,
} from "../../api/browser";
import type { S3AccountSelector } from "../../api/accountParams";
import { BrowserCopyValueModal } from "./BrowserDialogModals";
import BrowserObjectVersionsList from "./BrowserObjectVersionsList";
import {
  bulkActionClasses,
  toolbarButtonClasses,
} from "./browserConstants";
import {
  buildVersionRows,
  formatDateTime,
  formatLocalDateTime,
  previewKindForItem,
  toIsoString,
} from "./browserUtils";
import type {
  BrowserItem,
  ObjectDetailsTabId,
} from "./browserTypes";

type BrowserObjectDetailsModalProps = {
  accountId: S3AccountSelector;
  bucketName: string;
  item: BrowserItem;
  initialTab: ObjectDetailsTabId;
  versioningEnabled: boolean;
  sseCustomerKeyBase64?: string | null;
  useProxyTransfers: boolean;
  sseActive: boolean;
  copyUrlDisabled: boolean;
  copyUrlDisabledReason?: string;
  presignObjectRequest: (
    targetBucket: string,
    payload: PresignRequest,
  ) => Promise<PresignedUrl>;
  onClose: () => void;
  onDownload: (item: BrowserItem) => void;
  onCopyUrl: (item: BrowserItem | null) => Promise<void> | void;
  onRefreshBrowserObjects: (targetKey: string) => Promise<void>;
  onRestoreVersion: (version: BrowserObjectVersion) => Promise<void> | void;
  onDeleteVersion: (version: BrowserObjectVersion) => Promise<void> | void;
};

type MetadataDraft = {
  contentType: string;
  cacheControl: string;
  contentDisposition: string;
  contentEncoding: string;
  contentLanguage: string;
  expires: string;
};

type MetadataDraftItem = ObjectTag & { id: string };
type TagDraft = ObjectTag & { id: string };

type TabButton = {
  id: ObjectDetailsTabId;
  label: string;
};

const ARCHIVE_STORAGE_CLASSES = new Set([
  "GLACIER",
  "GLACIER_IR",
  "DEEP_ARCHIVE",
]);

const inputClasses =
  "w-full rounded-md border border-slate-200 bg-white px-2 py-1.5 ui-caption text-slate-700 shadow-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100";
const buttonPrimaryClasses =
  "inline-flex items-center justify-center rounded-md bg-primary px-3 py-1.5 ui-caption font-semibold text-white shadow-sm transition hover:bg-primary-600 disabled:opacity-60";
const buttonGhostClasses =
  "inline-flex items-center justify-center rounded-md px-2 py-1 ui-caption font-semibold text-slate-500 transition hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200";
const panelCardClasses =
  "rounded-lg border border-slate-200/80 bg-slate-50 px-3 py-3 ui-caption dark:border-slate-700 dark:bg-slate-900/40";

const storageClassOptions = [
  { value: "STANDARD", label: "STANDARD" },
  { value: "STANDARD_IA", label: "STANDARD_IA" },
  { value: "ONEZONE_IA", label: "ONEZONE_IA" },
  { value: "INTELLIGENT_TIERING", label: "INTELLIGENT_TIERING" },
  { value: "GLACIER", label: "GLACIER" },
  { value: "GLACIER_IR", label: "GLACIER_IR" },
  { value: "DEEP_ARCHIVE", label: "DEEP_ARCHIVE" },
];

const aclOptions = [
  { value: "private", label: "private" },
  { value: "public-read", label: "public-read" },
  { value: "public-read-write", label: "public-read-write" },
  { value: "authenticated-read", label: "authenticated-read" },
  { value: "bucket-owner-read", label: "bucket-owner-read" },
  { value: "bucket-owner-full-control", label: "bucket-owner-full-control" },
  { value: "aws-exec-read", label: "aws-exec-read" },
];

const normalizePairs = (items: ObjectTag[]) =>
  items.reduce<Record<string, string>>((acc, item) => {
    const key = item.key.trim();
    if (!key) return acc;
    acc[key] = item.value ?? "";
    return acc;
  }, {});

const formatRestoreStatus = (value?: string | null) => {
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

const nextTabAfterDeleted = (versioningEnabled: boolean) =>
  versioningEnabled ? "versions" : "preview";

const buildInlinePreviewDisposition = (filename: string) => {
  const fallback = filename.replace(/[^\x20-\x7E]+/g, "_").replace(/"/g, '\\"');
  const encoded = encodeURIComponent(filename);
  return `inline; filename="${fallback || "preview"}"; filename*=UTF-8''${encoded}`;
};

const readBlobAsText = async (blob: Blob) => {
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : "");
    reader.onerror = () => reject(reader.error ?? new Error("Unable to read blob."));
    reader.readAsText(blob);
  });
};

export default function BrowserObjectDetailsModal({
  accountId,
  bucketName,
  item,
  initialTab,
  versioningEnabled,
  sseCustomerKeyBase64,
  useProxyTransfers,
  sseActive,
  copyUrlDisabled,
  copyUrlDisabledReason,
  presignObjectRequest,
  onClose,
  onDownload,
  onCopyUrl,
  onRefreshBrowserObjects,
  onRestoreVersion,
  onDeleteVersion,
}: BrowserObjectDetailsModalProps) {
  const [activeTab, setActiveTab] = useState<ObjectDetailsTabId>(initialTab);
  const [itemSnapshot, setItemSnapshot] = useState(item);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [actionTone, setActionTone] = useState<"success" | "error" | null>(
    null,
  );
  const [copyDialogValue, setCopyDialogValue] = useState<string | null>(null);

  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewLoaded, setPreviewLoaded] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewContentType, setPreviewContentType] = useState<string | null>(
    null,
  );
  const [previewTextContent, setPreviewTextContent] = useState<string | null>(
    null,
  );
  const [previewError, setPreviewError] = useState<string | null>(null);

  const [metadata, setMetadata] = useState<ObjectMetadata | null>(null);
  const [metadataLoading, setMetadataLoading] = useState(false);
  const [metadataLoaded, setMetadataLoaded] = useState(false);
  const [metadataError, setMetadataError] = useState<string | null>(null);
  const [tagsVersionId, setTagsVersionId] = useState<string | null>(null);

  const [versions, setVersions] = useState<BrowserObjectVersion[]>([]);
  const [deleteMarkers, setDeleteMarkers] = useState<BrowserObjectVersion[]>(
    [],
  );
  const [versionsLoading, setVersionsLoading] = useState(false);
  const [versionsLoaded, setVersionsLoaded] = useState(false);
  const [versionsError, setVersionsError] = useState<string | null>(null);
  const [versionKeyMarker, setVersionKeyMarker] = useState<string | null>(null);
  const [versionIdMarker, setVersionIdMarker] = useState<string | null>(null);

  const [legalHoldStatus, setLegalHoldStatus] = useState<"ON" | "OFF">("OFF");
  const [legalHoldLoading, setLegalHoldLoading] = useState(false);
  const [legalHoldLoaded, setLegalHoldLoaded] = useState(false);
  const [legalHoldError, setLegalHoldError] = useState<string | null>(null);
  const [retentionMode, setRetentionMode] = useState<
    "" | "GOVERNANCE" | "COMPLIANCE"
  >("");
  const [retentionDate, setRetentionDate] = useState("");
  const [retentionBypass, setRetentionBypass] = useState(false);
  const [retentionLoading, setRetentionLoading] = useState(false);
  const [retentionLoaded, setRetentionLoaded] = useState(false);
  const [retentionError, setRetentionError] = useState<string | null>(null);

  const [metadataDraft, setMetadataDraft] = useState<MetadataDraft>({
    contentType: "",
    cacheControl: "",
    contentDisposition: "",
    contentEncoding: "",
    contentLanguage: "",
    expires: "",
  });
  const [metadataItems, setMetadataItems] = useState<MetadataDraftItem[]>([]);
  const [tagsDraft, setTagsDraft] = useState<TagDraft[]>([]);
  const [storageClass, setStorageClass] = useState("");
  const [aclValue, setAclValue] = useState("private");
  const [restoreDays, setRestoreDays] = useState("7");
  const [restoreTier, setRestoreTier] = useState<
    "Standard" | "Bulk" | "Expedited"
  >("Standard");
  const [presignExpires, setPresignExpires] = useState("");
  const [presignUrl, setPresignUrl] = useState("");
  const [presignMethod, setPresignMethod] = useState("");
  const [presignFields, setPresignFields] = useState<
    PresignedUrl["fields"] | null
  >(null);
  const [presignHeaders, setPresignHeaders] = useState<
    PresignedUrl["headers"] | null
  >(null);
  const [presignError, setPresignError] = useState<string | null>(null);

  const [savingMetadata, setSavingMetadata] = useState(false);
  const [savingTags, setSavingTags] = useState(false);
  const [savingStorage, setSavingStorage] = useState(false);
  const [savingAcl, setSavingAcl] = useState(false);
  const [savingLegalHold, setSavingLegalHold] = useState(false);
  const [savingRetention, setSavingRetention] = useState(false);
  const [savingRestore, setSavingRestore] = useState(false);
  const [savingPresign, setSavingPresign] = useState(false);
  const [savingVersionAction, setSavingVersionAction] = useState(false);

  const previewObjectUrlRef = useRef<string | null>(null);
  const tagIdRef = useRef(0);
  const metadataIdRef = useRef(0);

  const nextTagId = () => {
    tagIdRef.current += 1;
    return `tag-${tagIdRef.current}`;
  };

  const nextMetadataId = () => {
    metadataIdRef.current += 1;
    return `meta-${metadataIdRef.current}`;
  };

  const versionRows = useMemo(
    () => buildVersionRows(versions, deleteMarkers),
    [deleteMarkers, versions],
  );
  const latestVersionRow = useMemo(
    () => versionRows.find((row) => row.is_latest) ?? null,
    [versionRows],
  );
  const isDeletedCurrent = Boolean(
    itemSnapshot.isDeleted || latestVersionRow?.is_delete_marker,
  );
  const previewKind = useMemo(
    () => previewKindForItem(itemSnapshot, previewContentType),
    [itemSnapshot, previewContentType],
  );
  const versionId = metadata?.version_id ?? tagsVersionId ?? undefined;
  const currentStorageClass =
    metadata?.storage_class ?? storageClass ?? itemSnapshot.storageClass;
  const hasArchiveTab = Boolean(
    !isDeletedCurrent &&
      (ARCHIVE_STORAGE_CLASSES.has(currentStorageClass ?? "") ||
        metadata?.restore_status),
  );
  const restoreStatusLabel = useMemo(
    () => formatRestoreStatus(metadata?.restore_status),
    [metadata?.restore_status],
  );
  const statusClassName = useMemo(() => {
    if (!actionTone) return "";
    if (actionTone === "error") {
      return "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-500/30 dark:bg-rose-900/30 dark:text-rose-100";
    }
    return "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-900/30 dark:text-emerald-100";
  }, [actionTone]);

  const clearPreviewObjectUrl = () => {
    if (!previewObjectUrlRef.current) return;
    URL.revokeObjectURL(previewObjectUrlRef.current);
    previewObjectUrlRef.current = null;
  };

  const pushStatus = (message: string, tone: "success" | "error") => {
    setActionMessage(message);
    setActionTone(tone);
  };

  const resetPropertiesDrafts = (
    nextMetadata: ObjectMetadata | null,
    baseItem: BrowserItem = itemSnapshot,
  ) => {
    if (!nextMetadata) {
      setMetadataDraft({
        contentType: "",
        cacheControl: "",
        contentDisposition: "",
        contentEncoding: "",
        contentLanguage: "",
        expires: "",
      });
      setMetadataItems([]);
      setStorageClass(baseItem.storageClass ?? "");
      return;
    }
    setMetadataDraft({
      contentType: nextMetadata.content_type ?? "",
      cacheControl: nextMetadata.cache_control ?? "",
      contentDisposition: nextMetadata.content_disposition ?? "",
      contentEncoding: nextMetadata.content_encoding ?? "",
      contentLanguage: nextMetadata.content_language ?? "",
      expires: formatLocalDateTime(nextMetadata.expires),
    });
    setMetadataItems(
      Object.entries(nextMetadata.metadata || {}).map(([key, value]) => ({
        id: nextMetadataId(),
        key,
        value,
      })),
    );
    setStorageClass(nextMetadata.storage_class ?? baseItem.storageClass ?? "");
  };

  const resetTagsDraft = (nextTags: ObjectTag[]) => {
    setTagsDraft(
      nextTags.map((tag) => ({
        id: nextTagId(),
        key: tag.key,
        value: tag.value,
      })),
    );
  };

  const loadProperties = async (force = false) => {
    if (
      !bucketName ||
      !accountId ||
      itemSnapshot.type !== "file" ||
      isDeletedCurrent ||
      (!force && (metadataLoading || metadataLoaded))
    ) {
      return;
    }
    setMetadataLoading(true);
    setMetadataError(null);
    try {
      const [nextMetadata, nextTags] = await Promise.all([
        fetchObjectMetadata(
          accountId,
          bucketName,
          itemSnapshot.key,
          null,
          sseCustomerKeyBase64,
        ),
        getObjectTags(accountId, bucketName, itemSnapshot.key),
      ]);
      setMetadata(nextMetadata);
      setTagsVersionId(nextTags.version_id ?? null);
      resetPropertiesDrafts(nextMetadata, itemSnapshot);
      resetTagsDraft(nextTags.tags ?? []);
      setMetadataLoaded(true);
    } catch (err) {
      setMetadataError(extractApiError(err, "Unable to load object details."));
      if (force) {
        setMetadata(null);
        setTagsVersionId(null);
      }
    } finally {
      setMetadataLoading(false);
    }
  };

  const loadVersions = async (options?: {
    append?: boolean;
    keyMarker?: string | null;
    versionIdMarker?: string | null;
    force?: boolean;
  }) => {
    if (
      !bucketName ||
      !accountId ||
      !versioningEnabled ||
      itemSnapshot.type !== "file" ||
      (versionsLoading && !options?.force)
    ) {
      return;
    }
    const append = Boolean(options?.append);
    if (!append) {
      setVersionsError(null);
    }
    setVersionsLoading(true);
    try {
      const data = await listObjectVersions(accountId, bucketName, {
        key: itemSnapshot.key,
        keyMarker: append ? options?.keyMarker ?? versionKeyMarker : null,
        versionIdMarker: append ? options?.versionIdMarker ?? versionIdMarker : null,
        maxKeys: undefined,
      });
      setVersions((prev) =>
        append ? [...prev, ...(data.versions ?? [])] : data.versions ?? [],
      );
      setDeleteMarkers((prev) =>
        append
          ? [...prev, ...(data.delete_markers ?? [])]
          : data.delete_markers ?? [],
      );
      setVersionKeyMarker(data.next_key_marker ?? null);
      setVersionIdMarker(data.next_version_id_marker ?? null);
      setVersionsLoaded(true);
    } catch (err) {
      setVersionsError(extractApiError(err, "Unable to load versions."));
      if (!append) {
        setVersions([]);
        setDeleteMarkers([]);
        setVersionKeyMarker(null);
        setVersionIdMarker(null);
      }
    } finally {
      setVersionsLoading(false);
    }
  };

  const loadProtection = async (force = false) => {
    if (
      !bucketName ||
      !accountId ||
      itemSnapshot.type !== "file" ||
      isDeletedCurrent ||
      (!force &&
        ((legalHoldLoaded && retentionLoaded) ||
          legalHoldLoading ||
          retentionLoading))
    ) {
      return;
    }
    let protectionFailed = false;
    setLegalHoldLoading(true);
    setLegalHoldError(null);
    setRetentionLoading(true);
    setRetentionError(null);
    try {
      const [nextLegalHold, nextRetention] = await Promise.all([
        getObjectLegalHold(accountId, bucketName, itemSnapshot.key, versionId ?? null),
        getObjectRetention(accountId, bucketName, itemSnapshot.key, versionId ?? null),
      ]);
      setLegalHoldStatus(nextLegalHold.status === "ON" ? "ON" : "OFF");
      setRetentionMode(nextRetention.mode ?? "");
      setRetentionDate(formatLocalDateTime(nextRetention.retain_until));
      setLegalHoldLoaded(true);
      setRetentionLoaded(true);
    } catch (err) {
      protectionFailed = true;
      const message = extractApiError(
        err,
        "Unable to load protection settings.",
      );
      setLegalHoldError(message);
      setRetentionError(message);
      if (force) {
        setLegalHoldLoaded(false);
        setRetentionLoaded(false);
      }
    } finally {
      setLegalHoldLoading(false);
      setRetentionLoading(false);
      if (!protectionFailed) {
        setLegalHoldError(null);
        setRetentionError(null);
      }
    }
  };

  useEffect(() => {
    setItemSnapshot(item);
    setActiveTab(initialTab);
    setActionMessage(null);
    setActionTone(null);
    setCopyDialogValue(null);

    clearPreviewObjectUrl();
    setPreviewLoading(false);
    setPreviewLoaded(false);
    setPreviewUrl(null);
    setPreviewContentType(null);
    setPreviewTextContent(null);
    setPreviewError(null);

    setMetadata(null);
    setMetadataLoading(false);
    setMetadataLoaded(false);
    setMetadataError(null);
    setTagsVersionId(null);
    resetPropertiesDrafts(null, item);
    resetTagsDraft([]);
    setAclValue("private");

    setVersions([]);
    setDeleteMarkers([]);
    setVersionsLoading(false);
    setVersionsLoaded(false);
    setVersionsError(null);
    setVersionKeyMarker(null);
    setVersionIdMarker(null);

    setLegalHoldStatus("OFF");
    setLegalHoldLoading(false);
    setLegalHoldLoaded(false);
    setLegalHoldError(null);
    setRetentionMode("");
    setRetentionDate("");
    setRetentionBypass(false);
    setRetentionLoading(false);
    setRetentionLoaded(false);
    setRetentionError(null);

    setRestoreDays("7");
    setRestoreTier("Standard");
    setPresignExpires(
      formatLocalDateTime(new Date(Date.now() + 60 * 60 * 1000)),
    );
    setPresignUrl("");
    setPresignMethod("");
    setPresignFields(null);
    setPresignHeaders(null);
    setPresignError(null);
    setSavingVersionAction(false);

    return () => {
      clearPreviewObjectUrl();
    };
    // Draft reset is intentionally tied to modal target changes, not helper identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialTab, item]);

  useEffect(() => {
    if (!versioningEnabled && activeTab === "versions") {
      setActiveTab("preview");
    }
  }, [activeTab, versioningEnabled]);

  useEffect(() => {
    if (!versioningEnabled || !isDeletedCurrent || activeTab === "versions") {
      return;
    }
    setActiveTab(nextTabAfterDeleted(versioningEnabled));
  }, [activeTab, isDeletedCurrent, versioningEnabled]);

  useEffect(() => {
    if (activeTab === "preview" && !previewLoaded && !isDeletedCurrent) {
      let isMounted = true;
      setPreviewLoading(true);
      setPreviewError(null);
      setPreviewUrl(null);
      setPreviewContentType(null);
      setPreviewTextContent(null);
      clearPreviewObjectUrl();

      const loadPreview = async () => {
        const previewRequest: PresignRequest = {
          key: itemSnapshot.key,
          operation: "get_object",
          expires_in: 900,
          response_content_disposition: buildInlinePreviewDisposition(
            itemSnapshot.name,
          ),
        };
        const contentTypePromise = metadataLoaded
          ? Promise.resolve(metadata?.content_type ?? null)
          : fetchObjectMetadata(
              accountId,
              bucketName,
              itemSnapshot.key,
              null,
              sseCustomerKeyBase64,
            )
              .then((nextMetadata) => nextMetadata.content_type ?? null)
              .catch(() => null);

        const blob = useProxyTransfers
          ? await proxyDownload(
              accountId,
              bucketName,
              itemSnapshot.key,
              undefined,
              sseCustomerKeyBase64,
            )
          : await (async () => {
              const presign = await presignObjectRequest(
                bucketName,
                previewRequest,
              );
              const response = await fetch(presign.url, {
                headers: presign.headers || undefined,
              });
              if (!response.ok) {
                throw new Error("Preview download failed.");
              }
              return response.blob();
            })();
        if (!isMounted) return;
        const url = URL.createObjectURL(blob);
        previewObjectUrlRef.current = url;
        const contentType = (await contentTypePromise) ?? blob.type ?? null;
        const kind = previewKindForItem(itemSnapshot, contentType);
        if (kind === "text") {
          const textContent = await readBlobAsText(blob);
          if (!isMounted) return;
          setPreviewTextContent(textContent);
          setPreviewUrl(null);
        } else {
          setPreviewTextContent(null);
          setPreviewUrl(url);
        }
        setPreviewContentType(contentType);
      };

      loadPreview()
        .catch((err) => {
          if (!isMounted) return;
          setPreviewError(
            extractApiError(
              err,
              useProxyTransfers || sseActive
                ? "Unable to load preview."
                : "Unable to generate preview URL.",
            ),
          );
        })
        .finally(() => {
          if (!isMounted) return;
          setPreviewLoading(false);
          setPreviewLoaded(true);
        });

      return () => {
        isMounted = false;
      };
    }
    if (activeTab === "versions" && versioningEnabled && !versionsLoaded) {
      void loadVersions();
    }
    if (
      (activeTab === "properties" || activeTab === "archive") &&
      !metadataLoaded &&
      !isDeletedCurrent
    ) {
      void loadProperties();
    }
    if (activeTab === "protection" && !isDeletedCurrent) {
      void loadProtection();
    }
    return undefined;
    // Lazy loading is driven by tab transitions and modal state, not helper identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    accountId,
    activeTab,
    bucketName,
    isDeletedCurrent,
    itemSnapshot,
    metadata,
    metadataLoaded,
    presignObjectRequest,
    previewLoaded,
    sseActive,
    sseCustomerKeyBase64,
    useProxyTransfers,
    versioningEnabled,
    versionsLoaded,
  ]);

  const handleSaveMetadata = async () => {
    if (!bucketName || !itemSnapshot.key) return;
    setSavingMetadata(true);
    setActionMessage(null);
    try {
      const payload: ObjectMetadataUpdate = {
        key: itemSnapshot.key,
        version_id: versionId ?? null,
        content_type: metadataDraft.contentType,
        cache_control: metadataDraft.cacheControl,
        content_disposition: metadataDraft.contentDisposition,
        content_encoding: metadataDraft.contentEncoding,
        content_language: metadataDraft.contentLanguage,
        expires: toIsoString(metadataDraft.expires),
        metadata: normalizePairs(metadataItems),
      };
      await updateObjectMetadata(accountId, bucketName, payload);
      await loadProperties(true);
      await onRefreshBrowserObjects(itemSnapshot.key);
      pushStatus("Metadata updated.", "success");
    } catch (err) {
      pushStatus(extractApiError(err, "Unable to update metadata."), "error");
    } finally {
      setSavingMetadata(false);
    }
  };

  const handleSaveTags = async () => {
    if (!bucketName || !itemSnapshot.key) return;
    setSavingTags(true);
    setActionMessage(null);
    try {
      await updateObjectTags(accountId, bucketName, {
        key: itemSnapshot.key,
        version_id: versionId ?? null,
        tags: tagsDraft
          .filter((tag) => tag.key.trim().length > 0)
          .map((tag) => ({ key: tag.key, value: tag.value })),
      } satisfies ObjectTags);
      await loadProperties(true);
      await onRefreshBrowserObjects(itemSnapshot.key);
      pushStatus("Tags updated.", "success");
    } catch (err) {
      pushStatus(extractApiError(err, "Unable to update tags."), "error");
    } finally {
      setSavingTags(false);
    }
  };

  const handleSaveStorageClass = async () => {
    if (!bucketName || !itemSnapshot.key || !storageClass) return;
    setSavingStorage(true);
    setActionMessage(null);
    try {
      await updateObjectMetadata(accountId, bucketName, {
        key: itemSnapshot.key,
        version_id: versionId ?? null,
        storage_class: storageClass,
      });
      setItemSnapshot((prev) => ({ ...prev, storageClass }));
      await loadProperties(true);
      await onRefreshBrowserObjects(itemSnapshot.key);
      pushStatus("Storage class updated.", "success");
    } catch (err) {
      pushStatus(
        extractApiError(err, "Unable to update storage class."),
        "error",
      );
    } finally {
      setSavingStorage(false);
    }
  };

  const handleSaveAcl = async () => {
    if (!bucketName || !itemSnapshot.key) return;
    setSavingAcl(true);
    setActionMessage(null);
    try {
      await updateObjectAcl(accountId, bucketName, {
        key: itemSnapshot.key,
        acl: aclValue,
        version_id: versionId ?? null,
      });
      pushStatus("ACL updated.", "success");
    } catch (err) {
      pushStatus(extractApiError(err, "Unable to update ACL."), "error");
    } finally {
      setSavingAcl(false);
    }
  };

  const handleSaveLegalHold = async () => {
    if (!bucketName || !itemSnapshot.key) return;
    setSavingLegalHold(true);
    setActionMessage(null);
    try {
      await updateObjectLegalHold(accountId, bucketName, {
        key: itemSnapshot.key,
        status: legalHoldStatus,
        version_id: versionId ?? null,
      } satisfies ObjectLegalHold);
      await loadProtection(true);
      pushStatus("Legal hold updated.", "success");
    } catch (err) {
      pushStatus(
        extractApiError(err, "Unable to update legal hold."),
        "error",
      );
    } finally {
      setSavingLegalHold(false);
    }
  };

  const handleSaveRetention = async () => {
    if (!bucketName || !itemSnapshot.key || !retentionMode || !retentionDate) {
      return;
    }
    const retainUntil = toIsoString(retentionDate);
    if (!retainUntil) {
      pushStatus("Retention date is invalid.", "error");
      return;
    }
    setSavingRetention(true);
    setActionMessage(null);
    try {
      await updateObjectRetention(accountId, bucketName, {
        key: itemSnapshot.key,
        mode: retentionMode,
        retain_until: retainUntil,
        bypass_governance: retentionBypass,
        version_id: versionId ?? null,
      } satisfies ObjectRetention);
      await loadProtection(true);
      pushStatus("Retention updated.", "success");
    } catch (err) {
      pushStatus(
        extractApiError(err, "Unable to update retention."),
        "error",
      );
    } finally {
      setSavingRetention(false);
    }
  };

  const handleRestoreArchive = async () => {
    if (!bucketName || !itemSnapshot.key) return;
    const days = Number(restoreDays);
    if (!Number.isFinite(days) || days <= 0) {
      pushStatus("Restore days must be a positive number.", "error");
      return;
    }
    setSavingRestore(true);
    setActionMessage(null);
    try {
      await restoreObject(accountId, bucketName, {
        key: itemSnapshot.key,
        days,
        tier: restoreTier,
        version_id: versionId ?? null,
      } satisfies ObjectRestoreRequest);
      await loadProperties(true);
      await onRefreshBrowserObjects(itemSnapshot.key);
      pushStatus("Restore request sent.", "success");
    } catch (err) {
      pushStatus(extractApiError(err, "Unable to restore object."), "error");
    } finally {
      setSavingRestore(false);
    }
  };

  const handleGeneratePresign = async () => {
    if (!bucketName || !itemSnapshot.key) return;
    setPresignError(null);
    const expiresAt = presignExpires ? new Date(presignExpires) : null;
    if (!expiresAt || Number.isNaN(expiresAt.getTime())) {
      setPresignError("Select a valid expiration date.");
      return;
    }
    const seconds = Math.floor((expiresAt.getTime() - Date.now()) / 1000);
    if (seconds < 60) {
      setPresignError("Expiration must be at least 1 minute from now.");
      return;
    }
    if (seconds > 43200) {
      setPresignError("Expiration must be within 12 hours.");
      return;
    }
    setSavingPresign(true);
    try {
      const presigned = await presignObject(
        accountId,
        bucketName,
        {
          key: itemSnapshot.key,
          operation: "get_object",
          expires_in: seconds,
        },
        sseCustomerKeyBase64,
      );
      setPresignUrl(presigned.url);
      setPresignMethod(presigned.method);
      setPresignFields(presigned.fields ?? null);
      setPresignHeaders(presigned.headers ?? null);
      pushStatus("Signed URL generated.", "success");
    } catch (err) {
      const errorMessage = extractApiError(
        err,
        "Unable to generate signed URL.",
      );
      setPresignError(errorMessage);
      pushStatus(errorMessage, "error");
    } finally {
      setSavingPresign(false);
    }
  };

  const handleCopyPresign = async () => {
    if (!presignUrl) return;
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(presignUrl);
      pushStatus("URL copied to clipboard.", "success");
      return;
    }
    setCopyDialogValue(presignUrl);
  };

  const handleVersionAction = async (
    action: "restore" | "delete",
    version: BrowserObjectVersion,
  ) => {
    setSavingVersionAction(true);
    setActionMessage(null);
    try {
      if (action === "restore") {
        await onRestoreVersion(version);
      } else {
        await onDeleteVersion(version);
      }
      await loadVersions({ force: true });
      await loadProperties(true);
    } finally {
      setSavingVersionAction(false);
    }
  };

  const tabs = useMemo<TabButton[]>(() => {
    if (isDeletedCurrent) {
      return versioningEnabled ? [{ id: "versions", label: "Versions" }] : [];
    }
    const nextTabs: TabButton[] = [{ id: "preview", label: "Preview" }];
    if (versioningEnabled) {
      nextTabs.push({ id: "versions", label: "Versions" });
    }
    nextTabs.push(
      { id: "properties", label: "Properties" },
      { id: "protection", label: "Access & Protection" },
    );
    if (hasArchiveTab) {
      nextTabs.push({ id: "archive", label: "Archive" });
    }
    return nextTabs;
  }, [hasArchiveTab, isDeletedCurrent, versioningEnabled]);

  const renderPreviewContent = () => {
    if (isDeletedCurrent) {
      return null;
    }
    return (
      <div>
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-900/40">
          {previewLoading && (
            <div className="ui-body text-slate-500 dark:text-slate-300">
              Loading preview...
            </div>
          )}
          {previewError && (
            <div className="ui-body font-semibold text-rose-600 dark:text-rose-200">
              {previewError}
            </div>
          )}
          {!previewLoading &&
            !previewError &&
            previewUrl &&
            previewKind === "image" && (
              <img
                src={previewUrl}
                alt={itemSnapshot.name}
                className="mx-auto max-h-[58vh] w-full rounded-lg bg-white object-contain dark:bg-slate-950"
              />
            )}
          {!previewLoading &&
            !previewError &&
            previewUrl &&
            previewKind === "video" && (
              <video
                src={previewUrl}
                controls
                className="mx-auto max-h-[58vh] w-full rounded-lg bg-black"
              />
            )}
          {!previewLoading &&
            !previewError &&
            previewUrl &&
            previewKind === "audio" && (
              <audio src={previewUrl} controls className="w-full" />
            )}
          {!previewLoading &&
            !previewError &&
            previewTextContent !== null &&
            previewKind === "text" && (
              <pre className="max-h-[58vh] overflow-auto whitespace-pre-wrap rounded-lg border border-slate-200 bg-white p-4 ui-caption text-slate-700 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100">
                {previewTextContent}
              </pre>
            )}
          {!previewLoading &&
            !previewError &&
            previewUrl &&
            previewKind === "pdf" && (
              <iframe
                title="Object preview"
                src={previewUrl}
                className="h-[58vh] w-full rounded-lg border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-950"
              />
            )}
          {!previewLoading &&
            !previewError &&
            (!previewUrl || previewKind === "generic") && (
              <div className="rounded-lg border border-dashed border-slate-200 px-4 py-8 text-center ui-body text-slate-500 dark:border-slate-700 dark:text-slate-400">
                Preview not available for this file type.
              </div>
            )}
        </div>
      </div>
    );
  };

  const renderVersionsContent = () => (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="ui-caption text-slate-500 dark:text-slate-400">
          Inspect previous object states, delete markers, and restore the latest
          state when needed.
        </p>
        <button
          type="button"
          className={toolbarButtonClasses}
          onClick={() => void loadVersions({ force: true })}
          disabled={versionsLoading || savingVersionAction}
        >
          Refresh
        </button>
      </div>
      <BrowserObjectVersionsList
        title="Versions"
        versions={versionRows}
        loading={versionsLoading || savingVersionAction}
        error={versionsError}
        canLoadMore={Boolean(versionKeyMarker || versionIdMarker)}
        onLoadMore={() =>
          void loadVersions({
            append: true,
            keyMarker: versionKeyMarker,
            versionIdMarker: versionIdMarker,
          })
        }
        onRestoreVersion={(version) => void handleVersionAction("restore", version)}
        onDeleteVersion={(version) => void handleVersionAction("delete", version)}
      />
    </div>
  );

  const renderPropertiesContent = () => (
    <div className="space-y-4">
      {metadataLoading && !metadataLoaded && (
        <p className="ui-caption text-slate-500 dark:text-slate-400">
          Loading object details...
        </p>
      )}
      {metadataError && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 ui-caption font-semibold text-rose-700 dark:border-rose-500/30 dark:bg-rose-900/30 dark:text-rose-100">
          <span>{metadataError}</span>
          <button
            type="button"
            className={toolbarButtonClasses}
            onClick={() => void loadProperties(true)}
            disabled={metadataLoading}
          >
            Retry
          </button>
        </div>
      )}
      <div className="grid gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="space-y-4">
          <div className={panelCardClasses}>
            <div className="flex items-center justify-between">
              <p className="ui-caption font-semibold uppercase tracking-wide text-slate-400">
                Standard metadata
              </p>
              <button
                type="button"
                className={toolbarButtonClasses}
                onClick={() => void loadProperties(true)}
                disabled={metadataLoading}
              >
                Refresh
              </button>
            </div>
            <div className="mt-3 grid gap-3 md:grid-cols-2">
              <label className="space-y-1 ui-caption font-semibold text-slate-600 dark:text-slate-300">
                <span>Content type</span>
                <input
                  className={inputClasses}
                  value={metadataDraft.contentType}
                  onChange={(event) =>
                    setMetadataDraft((prev) => ({
                      ...prev,
                      contentType: event.target.value,
                    }))
                  }
                  placeholder="application/octet-stream"
                />
              </label>
              <label className="space-y-1 ui-caption font-semibold text-slate-600 dark:text-slate-300">
                <span>Cache control</span>
                <input
                  className={inputClasses}
                  value={metadataDraft.cacheControl}
                  onChange={(event) =>
                    setMetadataDraft((prev) => ({
                      ...prev,
                      cacheControl: event.target.value,
                    }))
                  }
                  placeholder="max-age=3600"
                />
              </label>
              <label className="space-y-1 ui-caption font-semibold text-slate-600 dark:text-slate-300">
                <span>Content disposition</span>
                <input
                  className={inputClasses}
                  value={metadataDraft.contentDisposition}
                  onChange={(event) =>
                    setMetadataDraft((prev) => ({
                      ...prev,
                      contentDisposition: event.target.value,
                    }))
                  }
                  placeholder="inline"
                />
              </label>
              <label className="space-y-1 ui-caption font-semibold text-slate-600 dark:text-slate-300">
                <span>Content encoding</span>
                <input
                  className={inputClasses}
                  value={metadataDraft.contentEncoding}
                  onChange={(event) =>
                    setMetadataDraft((prev) => ({
                      ...prev,
                      contentEncoding: event.target.value,
                    }))
                  }
                  placeholder="gzip"
                />
              </label>
              <label className="space-y-1 ui-caption font-semibold text-slate-600 dark:text-slate-300">
                <span>Content language</span>
                <input
                  className={inputClasses}
                  value={metadataDraft.contentLanguage}
                  onChange={(event) =>
                    setMetadataDraft((prev) => ({
                      ...prev,
                      contentLanguage: event.target.value,
                    }))
                  }
                  placeholder="en"
                />
              </label>
              <label className="space-y-1 ui-caption font-semibold text-slate-600 dark:text-slate-300">
                <span>Expires</span>
                <input
                  type="datetime-local"
                  className={inputClasses}
                  value={metadataDraft.expires}
                  onChange={(event) =>
                    setMetadataDraft((prev) => ({
                      ...prev,
                      expires: event.target.value,
                    }))
                  }
                />
              </label>
            </div>
            <div className="mt-3 flex items-center justify-end">
              <button
                type="button"
                className={buttonPrimaryClasses}
                onClick={() => void handleSaveMetadata()}
                disabled={savingMetadata || metadataLoading || !metadataLoaded}
              >
                {savingMetadata ? "Saving..." : "Save metadata"}
              </button>
            </div>
          </div>

          <div className={panelCardClasses}>
            <div className="flex items-center justify-between">
              <p className="ui-caption font-semibold uppercase tracking-wide text-slate-400">
                Custom metadata
              </p>
              <button
                type="button"
                className={buttonGhostClasses}
                onClick={() =>
                  setMetadataItems((prev) => [
                    ...prev,
                    { id: nextMetadataId(), key: "", value: "" },
                  ])
                }
              >
                Add metadata
              </button>
            </div>
            {metadataItems.length === 0 ? (
              <p className="mt-2 ui-caption text-slate-500 dark:text-slate-400">
                No custom metadata defined.
              </p>
            ) : (
              <div className="mt-2 space-y-2">
                {metadataItems.map((metadataItem) => (
                  <div
                    key={metadataItem.id}
                    className="grid gap-2 md:grid-cols-[1fr_1fr_auto]"
                  >
                    <input
                      className={inputClasses}
                      value={metadataItem.key}
                      onChange={(event) =>
                        setMetadataItems((prev) =>
                          prev.map((entry) =>
                            entry.id === metadataItem.id
                              ? { ...entry, key: event.target.value }
                              : entry,
                          ),
                        )
                      }
                      placeholder="x-custom-key"
                    />
                    <input
                      className={inputClasses}
                      value={metadataItem.value}
                      onChange={(event) =>
                        setMetadataItems((prev) =>
                          prev.map((entry) =>
                            entry.id === metadataItem.id
                              ? { ...entry, value: event.target.value }
                              : entry,
                          ),
                        )
                      }
                      placeholder="value"
                    />
                    <button
                      type="button"
                      className={buttonGhostClasses}
                      onClick={() =>
                        setMetadataItems((prev) =>
                          prev.filter((entry) => entry.id !== metadataItem.id),
                        )
                      }
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="space-y-4">
          <div className={panelCardClasses}>
            <div className="flex items-center justify-between">
              <p className="ui-caption font-semibold uppercase tracking-wide text-slate-400">
                Tags
              </p>
              <button
                type="button"
                className={buttonGhostClasses}
                onClick={() =>
                  setTagsDraft((prev) => [
                    ...prev,
                    { id: nextTagId(), key: "", value: "" },
                  ])
                }
              >
                Add tag
              </button>
            </div>
            {tagsDraft.length === 0 ? (
              <p className="mt-2 ui-caption text-slate-500 dark:text-slate-400">
                No tags defined.
              </p>
            ) : (
              <div className="mt-2 space-y-2">
                {tagsDraft.map((tag, idx) => (
                  <div
                    key={tag.id}
                    className="grid gap-2 md:grid-cols-[1fr_1fr_auto]"
                  >
                    <input
                      className={inputClasses}
                      value={tag.key}
                      onChange={(event) =>
                        setTagsDraft((prev) =>
                          prev.map((entry, index) =>
                            index === idx
                              ? { ...entry, key: event.target.value }
                              : entry,
                          ),
                        )
                      }
                      placeholder="Key"
                    />
                    <input
                      className={inputClasses}
                      value={tag.value}
                      onChange={(event) =>
                        setTagsDraft((prev) =>
                          prev.map((entry, index) =>
                            index === idx
                              ? { ...entry, value: event.target.value }
                              : entry,
                          ),
                        )
                      }
                      placeholder="Value"
                    />
                    <button
                      type="button"
                      className={buttonGhostClasses}
                      onClick={() =>
                        setTagsDraft((prev) =>
                          prev.filter((_, index) => index !== idx),
                        )
                      }
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </div>
            )}
            <div className="mt-3 flex items-center justify-end">
              <button
                type="button"
                className={buttonPrimaryClasses}
                onClick={() => void handleSaveTags()}
                disabled={savingTags || metadataLoading}
              >
                {savingTags ? "Saving..." : "Save tags"}
              </button>
            </div>
          </div>

          <div className={panelCardClasses}>
            <p className="ui-caption font-semibold uppercase tracking-wide text-slate-400">
              Storage class
            </p>
            <label className="mt-2 block space-y-1 ui-caption font-semibold text-slate-600 dark:text-slate-300">
              <span>Storage class</span>
              <select
                className={inputClasses}
                value={storageClass}
                onChange={(event) => setStorageClass(event.target.value)}
              >
                <option value="">Select storage class</option>
                {storageClassOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <p className="mt-2 ui-caption text-slate-500 dark:text-slate-400">
              Changing storage class triggers a copy of the object with the new
              storage tier.
            </p>
            <div className="mt-3 flex items-center justify-end">
              <button
                type="button"
                className={buttonPrimaryClasses}
                onClick={() => void handleSaveStorageClass()}
                disabled={savingStorage || !storageClass}
              >
                {savingStorage ? "Saving..." : "Save storage class"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );

  const renderProtectionContent = () => (
    <div className="grid gap-4 xl:grid-cols-2">
      <div className={panelCardClasses}>
        <p className="ui-caption font-semibold uppercase tracking-wide text-slate-400">
          Access
        </p>
        <label className="mt-3 block space-y-1 ui-caption font-semibold text-slate-600 dark:text-slate-300">
          <span>Canned ACL</span>
          <select
            className={inputClasses}
            value={aclValue}
            onChange={(event) => setAclValue(event.target.value)}
          >
            {aclOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <p className="mt-2 ui-caption text-slate-500 dark:text-slate-400">
          Updating the ACL overrides any custom grants currently applied.
        </p>
        <div className="mt-3 flex items-center justify-end">
          <button
            type="button"
            className={buttonPrimaryClasses}
            onClick={() => void handleSaveAcl()}
            disabled={savingAcl}
          >
            {savingAcl ? "Saving..." : "Save ACL"}
          </button>
        </div>
      </div>

      <div className={panelCardClasses}>
        <div className="flex items-center justify-between">
          <p className="ui-caption font-semibold uppercase tracking-wide text-slate-400">
            Legal hold
          </p>
          {legalHoldLoading && (
            <span className="ui-caption text-slate-500 dark:text-slate-400">
              Loading...
            </span>
          )}
        </div>
        {legalHoldError && (
          <p className="mt-2 ui-caption text-rose-600 dark:text-rose-200">
            {legalHoldError}
          </p>
        )}
        <div className="mt-2 grid gap-2 md:grid-cols-[1fr_auto]">
          <select
            className={inputClasses}
            value={legalHoldStatus}
            onChange={(event) =>
              setLegalHoldStatus(event.target.value as "ON" | "OFF")
            }
          >
            <option value="OFF">OFF</option>
            <option value="ON">ON</option>
          </select>
          <button
            type="button"
            className={buttonPrimaryClasses}
            onClick={() => void handleSaveLegalHold()}
            disabled={savingLegalHold || legalHoldLoading}
          >
            {savingLegalHold ? "Saving..." : "Update legal hold"}
          </button>
        </div>
      </div>

      <div className={panelCardClasses}>
        <div className="flex items-center justify-between">
          <p className="ui-caption font-semibold uppercase tracking-wide text-slate-400">
            Retention
          </p>
          {retentionLoading && (
            <span className="ui-caption text-slate-500 dark:text-slate-400">
              Loading...
            </span>
          )}
        </div>
        {retentionError && (
          <p className="mt-2 ui-caption text-rose-600 dark:text-rose-200">
            {retentionError}
          </p>
        )}
        <div className="mt-2 grid gap-2 md:grid-cols-2">
          <label className="space-y-1 ui-caption font-semibold text-slate-600 dark:text-slate-300">
            <span>Mode</span>
            <select
              className={inputClasses}
              value={retentionMode}
              onChange={(event) =>
                setRetentionMode(
                  event.target.value as "" | "GOVERNANCE" | "COMPLIANCE",
                )
              }
            >
              <option value="">Select mode</option>
              <option value="GOVERNANCE">GOVERNANCE</option>
              <option value="COMPLIANCE">COMPLIANCE</option>
            </select>
          </label>
          <label className="space-y-1 ui-caption font-semibold text-slate-600 dark:text-slate-300">
            <span>Retain until</span>
            <input
              type="datetime-local"
              className={inputClasses}
              value={retentionDate}
              onChange={(event) => setRetentionDate(event.target.value)}
            />
          </label>
        </div>
        <label className="mt-2 flex items-center gap-2 ui-caption text-slate-500 dark:text-slate-400">
          <input
            type="checkbox"
            checked={retentionBypass}
            onChange={(event) => setRetentionBypass(event.target.checked)}
          />
          Bypass governance retention
        </label>
        <div className="mt-3 flex items-center justify-end">
          <button
            type="button"
            className={buttonPrimaryClasses}
            onClick={() => void handleSaveRetention()}
            disabled={
              savingRetention ||
              retentionLoading ||
              !retentionMode ||
              !retentionDate
            }
          >
            {savingRetention ? "Saving..." : "Update retention"}
          </button>
        </div>
      </div>

      <div className={panelCardClasses}>
        <p className="ui-caption font-semibold uppercase tracking-wide text-slate-400">
          Signed URL
        </p>
        <p className="mt-2 ui-caption text-slate-500 dark:text-slate-400">
          Generate a temporary signed URL for this object (valid for up to 12
          hours).
        </p>
        {sseCustomerKeyBase64 && (
          <p className="mt-2 ui-caption font-semibold text-amber-600 dark:text-amber-200">
            SSE-C is active: URL alone is insufficient without the required
            SSE-C headers.
          </p>
        )}
        <label className="mt-3 block space-y-1 ui-caption font-semibold text-slate-600 dark:text-slate-300">
          <span>Expires at</span>
          <input
            type="datetime-local"
            className={inputClasses}
            value={presignExpires}
            onChange={(event) => setPresignExpires(event.target.value)}
          />
        </label>
        {presignError && (
          <p className="mt-2 ui-caption font-semibold text-rose-600 dark:text-rose-200">
            {presignError}
          </p>
        )}
        <div className="mt-3 flex items-center justify-end">
          <button
            type="button"
            className={buttonPrimaryClasses}
            onClick={() => void handleGeneratePresign()}
            disabled={savingPresign}
          >
            {savingPresign ? "Generating..." : "Generate URL"}
          </button>
        </div>
        {presignUrl && (
          <div className="mt-3 space-y-2 rounded-lg border border-slate-200/80 bg-white px-3 py-3 ui-caption dark:border-slate-700 dark:bg-slate-950/60">
            <div className="flex items-center justify-between">
              <span className="ui-caption font-semibold text-slate-600 dark:text-slate-300">
                {presignMethod || "GET"}
              </span>
              <button
                type="button"
                className={buttonGhostClasses}
                onClick={() => void handleCopyPresign()}
              >
                Copy URL
              </button>
            </div>
            <textarea
              className={`${inputClasses} h-24 font-mono`}
              readOnly
              value={presignUrl}
              spellCheck={false}
            />
            {presignFields && Object.keys(presignFields).length > 0 && (
              <div className="space-y-1">
                <p className="ui-caption font-semibold uppercase tracking-wide text-slate-400">
                  Fields
                </p>
                <pre className="overflow-auto rounded-md bg-slate-900/90 p-2 ui-caption text-slate-100">
                  {JSON.stringify(presignFields, null, 2)}
                </pre>
              </div>
            )}
            {presignHeaders && Object.keys(presignHeaders).length > 0 && (
              <div className="space-y-1">
                <p className="ui-caption font-semibold uppercase tracking-wide text-slate-400">
                  Headers
                </p>
                <pre className="overflow-auto rounded-md bg-slate-900/90 p-2 ui-caption text-slate-100">
                  {JSON.stringify(presignHeaders, null, 2)}
                </pre>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );

  const renderArchiveContent = () => (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
      <div className={panelCardClasses}>
        <p className="ui-caption font-semibold uppercase tracking-wide text-slate-400">
          Archive restore
        </p>
        <p className="mt-2 ui-caption text-slate-500 dark:text-slate-400">
          Restore archived objects (GLACIER, GLACIER_IR, DEEP_ARCHIVE) for a
          limited duration.
        </p>
        <div className="mt-3 grid gap-2 md:grid-cols-2">
          <label className="space-y-1 ui-caption font-semibold text-slate-600 dark:text-slate-300">
            <span>Days</span>
            <input
              type="number"
              min={1}
              className={inputClasses}
              value={restoreDays}
              onChange={(event) => setRestoreDays(event.target.value)}
            />
          </label>
          <label className="space-y-1 ui-caption font-semibold text-slate-600 dark:text-slate-300">
            <span>Tier</span>
            <select
              className={inputClasses}
              value={restoreTier}
              onChange={(event) =>
                setRestoreTier(
                  event.target.value as "Standard" | "Bulk" | "Expedited",
                )
              }
            >
              <option value="Standard">Standard</option>
              <option value="Bulk">Bulk</option>
              <option value="Expedited">Expedited</option>
            </select>
          </label>
        </div>
        <div className="mt-3 flex items-center justify-end">
          <button
            type="button"
            className={buttonPrimaryClasses}
            onClick={() => void handleRestoreArchive()}
            disabled={savingRestore}
          >
            {savingRestore ? "Submitting..." : "Request restore"}
          </button>
        </div>
      </div>

      <div className={panelCardClasses}>
        <p className="ui-caption font-semibold uppercase tracking-wide text-slate-400">
          Current status
        </p>
        <div className="mt-2 space-y-2 ui-caption text-slate-600 dark:text-slate-300">
          <div className="flex items-center justify-between gap-3">
            <span className="text-slate-500">Storage class</span>
            <span className="font-semibold text-slate-700 dark:text-slate-100">
              {currentStorageClass ?? "-"}
            </span>
          </div>
          <div className="flex items-start justify-between gap-3">
            <span className="text-slate-500">Restore status</span>
            <span className="max-w-[24rem] text-right font-semibold text-slate-700 dark:text-slate-100">
              {restoreStatusLabel ?? "No active restore."}
            </span>
          </div>
        </div>
      </div>
    </div>
  );

  const renderContent = () => {
    if (isDeletedCurrent) {
      return (
        <div className="space-y-4">
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 ui-caption font-semibold text-amber-800 dark:border-amber-500/30 dark:bg-amber-900/20 dark:text-amber-100">
            Latest state is deleted. Use <span className="font-bold">Versions</span> to
            restore the object or remove the delete marker.
          </div>
          {versioningEnabled ? renderVersionsContent() : null}
        </div>
      );
    }

    switch (activeTab) {
      case "preview":
        return renderPreviewContent();
      case "versions":
        return renderVersionsContent();
      case "properties":
        return renderPropertiesContent();
      case "protection":
        return renderProtectionContent();
      case "archive":
        return renderArchiveContent();
      default:
        return null;
    }
  };

  return (
    <>
      <Modal
        title={`Object details · ${itemSnapshot.name}`}
        onClose={() => {
          clearPreviewObjectUrl();
          onClose();
        }}
        maxWidthClass="max-w-7xl"
        maxBodyHeightClass="h-[88vh]"
      >
        <div className="space-y-4">
          <div className="sticky top-0 z-10 -mx-6 -mt-4 space-y-4 border-b border-slate-200 bg-white/95 px-6 py-4 backdrop-blur-sm dark:border-slate-800 dark:bg-slate-950/95">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="min-w-0 space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  {isDeletedCurrent && (
                    <span className="rounded-md border border-rose-200 bg-rose-50 px-2 py-0.5 ui-caption font-semibold text-rose-700 dark:border-rose-500/30 dark:bg-rose-900/30 dark:text-rose-100">
                      Deleted
                    </span>
                  )}
                  {restoreStatusLabel && (
                    <span className="rounded-md border border-amber-200 bg-amber-50 px-2 py-0.5 ui-caption font-semibold text-amber-700 dark:border-amber-500/30 dark:bg-amber-900/20 dark:text-amber-100">
                      {restoreStatusLabel}
                    </span>
                  )}
                </div>
                <div>
                  <p className="break-all ui-subtitle font-semibold text-slate-900 dark:text-slate-50">
                    {itemSnapshot.name}
                  </p>
                  <p className="break-all ui-caption text-slate-500 dark:text-slate-400">
                    {bucketName} / {itemSnapshot.key}
                  </p>
                </div>
                <div className="flex flex-wrap gap-x-4 gap-y-1 ui-caption text-slate-600 dark:text-slate-300">
                  <span>Size: {itemSnapshot.size}</span>
                  <span>Modified: {itemSnapshot.modified}</span>
                  <span>Storage class: {currentStorageClass ?? "-"}</span>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {!isDeletedCurrent && (
                  <button
                    type="button"
                    className={bulkActionClasses}
                    onClick={() => onDownload(itemSnapshot)}
                  >
                    Download
                  </button>
                )}
                {!isDeletedCurrent && !copyUrlDisabled && (
                  <button
                    type="button"
                    className={bulkActionClasses}
                    onClick={() => void onCopyUrl(itemSnapshot)}
                  >
                    Copy URL
                  </button>
                )}
                {!isDeletedCurrent && copyUrlDisabled && (
                  <button
                    type="button"
                    className={bulkActionClasses}
                    disabled
                    title={copyUrlDisabledReason ?? "Copy URL is unavailable."}
                  >
                    Copy URL
                  </button>
                )}
              </div>
            </div>

            {actionMessage && (
              <div
                className={`rounded-lg border px-3 py-2 ui-caption font-semibold ${statusClassName}`}
              >
                {actionMessage}
              </div>
            )}

            {tabs.length > 0 && (
              <div className="flex flex-wrap gap-2" role="tablist" aria-label="Object details tabs">
                {tabs.map((tab) => {
                  const isActive = tab.id === activeTab;
                  return (
                    <button
                      key={tab.id}
                      type="button"
                      role="tab"
                      aria-selected={isActive}
                      onClick={() => setActiveTab(tab.id)}
                      className={[
                        "rounded-md px-3 py-1.5 ui-caption font-semibold transition",
                        isActive
                          ? "bg-primary-100/70 text-primary-800 dark:bg-primary-500/20 dark:text-primary-100"
                          : "text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800",
                      ].join(" ")}
                    >
                      {tab.label}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <div>{renderContent()}</div>
        </div>
      </Modal>

      {copyDialogValue && (
        <BrowserCopyValueModal
          title="Copy URL"
          label="Signed URL"
          value={copyDialogValue}
          onCopySuccess={() => pushStatus("URL copied to clipboard.", "success")}
          onClose={() => setCopyDialogValue(null)}
        />
      )}
    </>
  );
}
