/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import Modal from "../../components/Modal";
import UiCheckboxField from "../../components/ui/UiCheckboxField";
import { extractApiError } from "../../utils/apiError";
import ObjectPreview, {
  type ObjectPreviewLoadResult,
} from "../shared/ObjectPreview";
import {
  fetchObjectMetadata,
  presignObject,
  proxyDownload,
  restoreObject,
  updateObjectAcl,
  updateObjectLegalHold,
  updateObjectMetadata,
  updateObjectRetention,
  updateObjectTags,
  type BrowserObjectVersion,
  type BrowserRequestOptions,
  type ObjectLegalHold,
  type ObjectMetadataUpdate,
  type ObjectRetention,
  type ObjectRestoreRequest,
  type ObjectTags,
  type PresignedUrl,
  type PresignRequest,
} from "../../api/browser";
import type { S3AccountSelector } from "../../api/accountParams";
import { BrowserCopyValueModal } from "./BrowserDialogModals";
import BrowserObjectVersionsList from "./BrowserObjectVersionsList";
import {
  browserPanelCardClasses,
  bulkActionClasses,
  formInputClasses,
  toolbarButtonClasses,
  toolbarPrimaryClasses,
} from "./browserConstants";
import {
  formatLocalDateTime,
  toIsoString,
} from "./browserUtils";
import {
  ARCHIVE_STORAGE_CLASSES,
  OBJECT_LOCK_DISABLED_MESSAGE,
  aclOptions,
  buildInlinePreviewDisposition,
  formatRestoreStatus,
  nextTabAfterDeleted,
  normalizeObjectDetailPairs,
  storageClassOptions,
} from "./browserObjectDetailsModel";
import type {
  BrowserItem,
  ObjectDetailsTabId,
} from "./browserTypes";
import { useBrowserObjectVersions } from "./useBrowserObjectVersions";
import {
  useBrowserObjectProtection,
  type ObjectRetentionMode,
} from "./useBrowserObjectProtection";
import { useBrowserObjectProperties } from "./useBrowserObjectProperties";

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
  readOnly?: boolean;
  requestOptions?: BrowserRequestOptions;
};

type TabButton = {
  id: ObjectDetailsTabId;
  label: string;
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
  readOnly = false,
  requestOptions,
}: BrowserObjectDetailsModalProps) {
  const [activeTab, setActiveTab] = useState<ObjectDetailsTabId>(initialTab);
  const [itemSnapshot, setItemSnapshot] = useState(item);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [actionTone, setActionTone] = useState<"success" | "error" | null>(
    null,
  );
  const [copyDialogValue, setCopyDialogValue] = useState<string | null>(null);

  const [aclValue, setAclValue] = useState("private");
  const [restoreDays, setRestoreDays] = useState("7");
  const [restoreTier, setRestoreTier] = useState<
    "Standard" | "Bulk" | "Expedited"
  >("Standard");
  const [presignExpires, setPresignExpires] = useState("");
  const [presignUrl, setPresignUrl] = useState("");
  const [presignMethod, setPresignMethod] = useState("");
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

  const {
    rows: versionRows,
    latestRow: latestVersionRow,
    loading: versionsLoading,
    loaded: versionsLoaded,
    error: versionsError,
    canLoadMore: canLoadMoreVersions,
    load: loadVersions,
  } = useBrowserObjectVersions({
    accountId,
    bucketName,
    enabled: versioningEnabled && itemSnapshot.type === "file",
    objectKey: itemSnapshot.key,
    requestOptions,
  });
  const isDeletedCurrent = Boolean(
    itemSnapshot.isDeleted || latestVersionRow?.is_delete_marker,
  );
  const {
    metadata,
    loading: metadataLoading,
    loaded: metadataLoaded,
    error: metadataError,
    versionId,
    metadataDraft,
    setMetadataDraft,
    metadataItems,
    setMetadataItems,
    tagsDraft,
    setTagsDraft,
    storageClass,
    setStorageClass,
    nextTagId,
    nextMetadataId,
    load: loadProperties,
    reset: resetObjectProperties,
  } = useBrowserObjectProperties({
    accountId,
    bucketName,
    isDeleted: isDeletedCurrent,
    item: itemSnapshot,
    requestOptions,
    sseCustomerKeyBase64,
  });
  const {
    legalHoldStatus,
    setLegalHoldStatus,
    legalHoldError,
    retentionMode,
    setRetentionMode,
    retentionDate,
    setRetentionDate,
    retentionBypass,
    setRetentionBypass,
    retentionError,
    objectLockUnavailable,
    loading: protectionLoading,
    load: loadProtection,
  } = useBrowserObjectProtection({
    accountId,
    bucketName,
    enabled:
      activeTab === "protection" &&
      itemSnapshot.type === "file" &&
      !isDeletedCurrent,
    objectKey: itemSnapshot.key,
    requestOptions,
    versionId,
  });
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

  const pushStatus = (message: string, tone: "success" | "error") => {
    setActionMessage(message);
    setActionTone(tone);
  };

  const loadObjectPreview = useCallback(
    async (signal: AbortSignal): Promise<ObjectPreviewLoadResult> => {
      const previewRequest: PresignRequest = {
        key: itemSnapshot.key,
        operation: "get_object",
        expires_in: 900,
        response_content_disposition: buildInlinePreviewDisposition(
          itemSnapshot.name,
        ),
      };
      const blob = useProxyTransfers
        ? await proxyDownload(
            accountId,
            bucketName,
            itemSnapshot.key,
            signal,
            sseCustomerKeyBase64,
            requestOptions,
          )
        : await (async () => {
            const presign = await presignObjectRequest(
              bucketName,
              previewRequest,
            );
            const response = await fetch(presign.url, {
              headers: presign.headers || undefined,
              signal,
            });
            if (!response.ok) {
              throw new Error("Preview download failed.");
            }
            return response.blob();
          })();
      return {
        blob,
        contentType: blob.type || null,
      };
    },
    [
      accountId,
      bucketName,
      itemSnapshot.key,
      itemSnapshot.name,
      presignObjectRequest,
      requestOptions,
      sseCustomerKeyBase64,
      useProxyTransfers,
    ],
  );

  const resolveObjectPreviewContentType = useCallback(
    async (signal: AbortSignal) => {
      if (metadataLoaded) return metadata?.content_type ?? null;
      try {
        const nextMetadata = await fetchObjectMetadata(
          accountId,
          bucketName,
          itemSnapshot.key,
          null,
          sseCustomerKeyBase64,
          signal,
          requestOptions,
        );
        return nextMetadata.content_type ?? null;
      } catch (error) {
        if (signal.aborted) throw error;
        return null;
      }
    },
    [
      accountId,
      bucketName,
      itemSnapshot.key,
      metadata?.content_type,
      metadataLoaded,
      requestOptions,
      sseCustomerKeyBase64,
    ],
  );

  useEffect(() => {
    setItemSnapshot(item);
    setActiveTab(initialTab);
    setActionMessage(null);
    setActionTone(null);
    setCopyDialogValue(null);

    resetObjectProperties(item);
    setAclValue("private");

    setRestoreDays("7");
    setRestoreTier("Standard");
    setPresignExpires(
      formatLocalDateTime(new Date(Date.now() + 60 * 60 * 1000)),
    );
    setPresignUrl("");
    setPresignMethod("");
    setPresignHeaders(null);
    setPresignError(null);
    setSavingVersionAction(false);
  }, [initialTab, item, resetObjectProperties]);

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
    return undefined;
  }, [
    activeTab,
    isDeletedCurrent,
    metadataLoaded,
    loadProperties,
    loadVersions,
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
        metadata: normalizeObjectDetailPairs(metadataItems),
      };
      await updateObjectMetadata(accountId, bucketName, payload, undefined, requestOptions);
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
      } satisfies ObjectTags, undefined, requestOptions);
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
      }, undefined, requestOptions);
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
      }, undefined, requestOptions);
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
      } satisfies ObjectLegalHold, undefined, requestOptions);
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
      } satisfies ObjectRetention, undefined, requestOptions);
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
      } satisfies ObjectRestoreRequest, requestOptions);
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
        requestOptions,
      );
      setPresignUrl(presigned.url);
      setPresignMethod(presigned.method);
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
    if (versioningEnabled && !readOnly) {
      nextTabs.push({ id: "versions", label: "Versions" });
    }
    nextTabs.push({ id: "properties", label: "Properties" });
    if (!readOnly) {
      nextTabs.push({ id: "protection", label: "Access & Protection" });
    }
    if (hasArchiveTab && !readOnly) {
      nextTabs.push({ id: "archive", label: "Archive" });
    }
    return nextTabs;
  }, [hasArchiveTab, isDeletedCurrent, readOnly, versioningEnabled]);

  const renderPreviewContent = () => {
    if (isDeletedCurrent) {
      return null;
    }
    return (
      <ObjectPreview
        name={itemSnapshot.name}
        sizeBytes={itemSnapshot.sizeBytes}
        contentType={metadataLoaded ? metadata?.content_type : null}
        resolveContentType={resolveObjectPreviewContentType}
        loadBlob={loadObjectPreview}
        formatError={(error) =>
          extractApiError(
            error,
            useProxyTransfers || sseActive
              ? "Unable to load preview."
              : "Unable to generate preview URL.",
          )
        }
      />
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
        canLoadMore={canLoadMoreVersions}
        onLoadMore={() => void loadVersions({ append: true })}
        onRestoreVersion={(version) => void handleVersionAction("restore", version)}
        onDeleteVersion={(version) => void handleVersionAction("delete", version)}
        readOnly={readOnly}
      />
    </div>
  );

  const renderPropertiesContent = () => (
    <>
    {readOnly && (
      <p className="mb-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 ui-caption text-slate-600 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-300">
        Properties are read-only in the Standard Browser profile.
      </p>
    )}
    <fieldset disabled={readOnly} className="space-y-4">
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
          <div className={browserPanelCardClasses}>
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
                  className={formInputClasses}
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
                  className={formInputClasses}
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
                  className={formInputClasses}
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
                  className={formInputClasses}
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
                  className={formInputClasses}
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
                  className={formInputClasses}
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
                className={toolbarPrimaryClasses}
                onClick={() => void handleSaveMetadata()}
                disabled={savingMetadata || metadataLoading || !metadataLoaded}
              >
                {savingMetadata ? "Saving..." : "Save metadata"}
              </button>
            </div>
          </div>

          <div className={browserPanelCardClasses}>
            <div className="flex items-center justify-between">
              <p className="ui-caption font-semibold uppercase tracking-wide text-slate-400">
                Custom metadata
              </p>
              <button
                type="button"
                className={toolbarButtonClasses}
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
                      className={formInputClasses}
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
                      className={formInputClasses}
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
                      className={toolbarButtonClasses}
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
          <div className={browserPanelCardClasses}>
            <div className="flex items-center justify-between">
              <p className="ui-caption font-semibold uppercase tracking-wide text-slate-400">
                Tags
              </p>
              <button
                type="button"
                className={toolbarButtonClasses}
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
                      className={formInputClasses}
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
                      className={formInputClasses}
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
                      className={toolbarButtonClasses}
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
                className={toolbarPrimaryClasses}
                onClick={() => void handleSaveTags()}
                disabled={savingTags || metadataLoading}
              >
                {savingTags ? "Saving..." : "Save tags"}
              </button>
            </div>
          </div>

          <div className={browserPanelCardClasses}>
            <p className="ui-caption font-semibold uppercase tracking-wide text-slate-400">
              Storage class
            </p>
            <label className="mt-2 block space-y-1 ui-caption font-semibold text-slate-600 dark:text-slate-300">
              <span>Storage class</span>
              <select
                className={formInputClasses}
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
                className={toolbarPrimaryClasses}
                onClick={() => void handleSaveStorageClass()}
                disabled={savingStorage || !storageClass}
              >
                {savingStorage ? "Saving..." : "Save storage class"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </fieldset>
    </>
  );

  const renderProtectionContent = () => (
    <div className="grid gap-4 xl:grid-cols-2">
      <div className={browserPanelCardClasses}>
        <p className="ui-caption font-semibold uppercase tracking-wide text-slate-400">
          Access
        </p>
        <label className="mt-3 block space-y-1 ui-caption font-semibold text-slate-600 dark:text-slate-300">
          <span>Canned ACL</span>
          <select
            className={formInputClasses}
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
            className={toolbarPrimaryClasses}
            onClick={() => void handleSaveAcl()}
            disabled={savingAcl}
          >
            {savingAcl ? "Saving..." : "Save ACL"}
          </button>
        </div>
      </div>

      <div
        className={`${browserPanelCardClasses} ${objectLockUnavailable ? "opacity-60" : ""}`}
      >
        <div className="flex items-center justify-between">
          <p className="ui-caption font-semibold uppercase tracking-wide text-slate-400">
            Legal hold
          </p>
          {protectionLoading && (
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
        {objectLockUnavailable && (
          <p className="mt-2 ui-caption text-slate-500 dark:text-slate-400">
            {OBJECT_LOCK_DISABLED_MESSAGE}
          </p>
        )}
        <div className="mt-2 grid gap-2 md:grid-cols-[1fr_auto]">
          <select
            className={formInputClasses}
            value={legalHoldStatus}
            onChange={(event) =>
              setLegalHoldStatus(event.target.value as "ON" | "OFF")
            }
            disabled={objectLockUnavailable}
          >
            <option value="OFF">OFF</option>
            <option value="ON">ON</option>
          </select>
          <button
            type="button"
            className={toolbarPrimaryClasses}
            onClick={() => void handleSaveLegalHold()}
            disabled={savingLegalHold || protectionLoading || objectLockUnavailable}
          >
            {savingLegalHold ? "Saving..." : "Update legal hold"}
          </button>
        </div>
      </div>

      <div
        className={`${browserPanelCardClasses} ${objectLockUnavailable ? "opacity-60" : ""}`}
      >
        <div className="flex items-center justify-between">
          <p className="ui-caption font-semibold uppercase tracking-wide text-slate-400">
            Retention
          </p>
          {protectionLoading && (
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
        {objectLockUnavailable && (
          <p className="mt-2 ui-caption text-slate-500 dark:text-slate-400">
            {OBJECT_LOCK_DISABLED_MESSAGE}
          </p>
        )}
        <div className="mt-2 grid gap-2 md:grid-cols-2">
          <label className="space-y-1 ui-caption font-semibold text-slate-600 dark:text-slate-300">
            <span>Mode</span>
            <select
              className={formInputClasses}
              value={retentionMode}
              onChange={(event) =>
                setRetentionMode(
                  event.target.value as ObjectRetentionMode,
                )
              }
              disabled={objectLockUnavailable}
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
              className={formInputClasses}
              value={retentionDate}
              onChange={(event) => setRetentionDate(event.target.value)}
              disabled={objectLockUnavailable}
            />
          </label>
        </div>
        <UiCheckboxField
          checked={retentionBypass}
          onChange={(event) => setRetentionBypass(event.target.checked)}
          disabled={objectLockUnavailable}
          className="mt-2 ui-caption text-slate-500 dark:text-slate-400"
        >
          Bypass governance retention
        </UiCheckboxField>
        <div className="mt-3 flex items-center justify-end">
          <button
            type="button"
            className={toolbarPrimaryClasses}
            onClick={() => void handleSaveRetention()}
            disabled={
              savingRetention ||
              protectionLoading ||
              objectLockUnavailable ||
              !retentionMode ||
              !retentionDate
            }
          >
            {savingRetention ? "Saving..." : "Update retention"}
          </button>
        </div>
      </div>

      <div className={browserPanelCardClasses}>
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
            className={formInputClasses}
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
            className={toolbarPrimaryClasses}
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
                className={toolbarButtonClasses}
                onClick={() => void handleCopyPresign()}
              >
                Copy URL
              </button>
            </div>
            <textarea
              className={`${formInputClasses} h-24 font-mono`}
              readOnly
              value={presignUrl}
              spellCheck={false}
            />
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
      <div className={browserPanelCardClasses}>
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
              className={formInputClasses}
              value={restoreDays}
              onChange={(event) => setRestoreDays(event.target.value)}
            />
          </label>
          <label className="space-y-1 ui-caption font-semibold text-slate-600 dark:text-slate-300">
            <span>Tier</span>
            <select
              className={formInputClasses}
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
            className={toolbarPrimaryClasses}
            onClick={() => void handleRestoreArchive()}
            disabled={savingRestore}
          >
            {savingRestore ? "Submitting..." : "Request restore"}
          </button>
        </div>
      </div>

      <div className={browserPanelCardClasses}>
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
        onClose={onClose}
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
