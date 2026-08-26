/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useEffect, useMemo, useState } from "react";
import Modal from "../../components/Modal";
import { extractApiError } from "../../utils/apiError";
import ObjectPreview from "../shared/ObjectPreview";
import {
  type BrowserObjectVersion,
  type BrowserRequestOptions,
  type PresignedUrl,
  type PresignRequest,
} from "../../api/browser";
import type { S3AccountSelector } from "../../api/accountParams";
import { BrowserCopyValueModal } from "./BrowserDialogModals";
import BrowserObjectArchiveTab from "./BrowserObjectArchiveTab";
import BrowserObjectPropertiesTab from "./BrowserObjectPropertiesTab";
import BrowserObjectProtectionTab from "./BrowserObjectProtectionTab";
import BrowserObjectVersionsTab from "./BrowserObjectVersionsTab";
import { bulkActionClasses } from "./browserConstants";
import {
  ARCHIVE_STORAGE_CLASSES,
  formatRestoreStatus,
  nextTabAfterDeleted,
} from "./browserObjectDetailsModel";
import type {
  BrowserItem,
  ObjectDetailsTabId,
} from "./browserTypes";
import { useBrowserObjectVersions } from "./useBrowserObjectVersions";
import { useBrowserObjectProtection } from "./useBrowserObjectProtection";
import { useBrowserObjectProperties } from "./useBrowserObjectProperties";
import { useBrowserObjectSignedUrl } from "./useBrowserObjectSignedUrl";
import { useBrowserObjectArchiveRestore } from "./useBrowserObjectArchiveRestore";
import { useBrowserObjectAcl } from "./useBrowserObjectAcl";
import { useBrowserObjectPreview } from "./useBrowserObjectPreview";

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

  const {
    rows: versionRows,
    latestRow: latestVersionRow,
    loading: versionsLoading,
    loaded: versionsLoaded,
    error: versionsError,
    canLoadMore: canLoadMoreVersions,
    load: loadVersions,
    savingAction: savingVersionAction,
    isCurrentScope: isVersionsScopeCurrent,
    runAction: runVersionAction,
  } = useBrowserObjectVersions({
    accountId,
    bucketName,
    enabled: versioningEnabled && itemSnapshot.type === "file",
    onDeleteVersion,
    onRestoreVersion,
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
    updateMetadataDraft,
    metadataItems,
    addMetadataItem,
    updateMetadataItem,
    removeMetadataItem,
    tagsDraft,
    addTag,
    updateTag,
    removeTag,
    storageClass,
    setStorageClass,
    savingMetadata,
    savingTags,
    savingStorageClass: savingStorage,
    load: loadProperties,
    reset: resetObjectProperties,
    isCurrentScope: isPropertiesScopeCurrent,
    saveMetadata,
    saveTags,
    saveStorageClass,
  } = useBrowserObjectProperties({
    accountId,
    bucketName,
    isDeleted: isDeletedCurrent,
    item: itemSnapshot,
    requestOptions,
    sseCustomerKeyBase64,
  });
  const {
    loadBlob: loadObjectPreview,
    resolveContentType: resolveObjectPreviewContentType,
  } = useBrowserObjectPreview({
    accountId,
    bucketName,
    metadataContentType: metadata?.content_type,
    metadataLoaded,
    objectKey: itemSnapshot.key,
    objectName: itemSnapshot.name,
    presignObjectRequest,
    requestOptions,
    sseCustomerKeyBase64,
    useProxyTransfers,
  });
  const {
    value: aclValue,
    setValue: setAclValue,
    saving: savingAcl,
    isCurrentScope: isAclScopeCurrent,
    save: saveAcl,
  } = useBrowserObjectAcl({
    accountId,
    bucketName,
    objectKey: itemSnapshot.key,
    requestOptions,
    versionId,
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
    savingLegalHold,
    savingRetention,
    isCurrentScope: isProtectionScopeCurrent,
    saveLegalHold,
    saveRetention,
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
  const {
    days: restoreDays,
    setDays: setRestoreDays,
    tier: restoreTier,
    setTier: setRestoreTier,
    saving: savingRestore,
    isCurrentScope: isArchiveRestoreScopeCurrent,
    restore: restoreArchive,
  } = useBrowserObjectArchiveRestore({
    accountId,
    bucketName,
    loadProperties,
    objectKey: itemSnapshot.key,
    requestOptions,
    versionId,
  });
  const {
    expires: presignExpires,
    setExpires: setPresignExpires,
    url: presignUrl,
    method: presignMethod,
    headers: presignHeaders,
    error: presignError,
    generating: savingPresign,
    generate: generatePresign,
    copy: copyPresign,
  } = useBrowserObjectSignedUrl({
    accountId,
    bucketName,
    objectKey: itemSnapshot.key,
    requestOptions,
    sseCustomerKeyBase64,
  });
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

  useEffect(() => {
    setItemSnapshot(item);
    setActiveTab(initialTab);
    setActionMessage(null);
    setActionTone(null);
    setCopyDialogValue(null);

    resetObjectProperties(item);
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
    setActionMessage(null);
    try {
      if (!(await saveMetadata()) || !isPropertiesScopeCurrent()) return;
      await onRefreshBrowserObjects(itemSnapshot.key);
      if (!isPropertiesScopeCurrent()) return;
      pushStatus("Metadata updated.", "success");
    } catch (err) {
      pushStatus(extractApiError(err, "Unable to update metadata."), "error");
    }
  };

  const handleSaveTags = async () => {
    setActionMessage(null);
    try {
      if (!(await saveTags()) || !isPropertiesScopeCurrent()) return;
      await onRefreshBrowserObjects(itemSnapshot.key);
      if (!isPropertiesScopeCurrent()) return;
      pushStatus("Tags updated.", "success");
    } catch (err) {
      pushStatus(extractApiError(err, "Unable to update tags."), "error");
    }
  };

  const handleSaveStorageClass = async () => {
    setActionMessage(null);
    try {
      const savedStorageClass = await saveStorageClass();
      if (!savedStorageClass || !isPropertiesScopeCurrent()) return;
      setItemSnapshot((prev) => ({
        ...prev,
        storageClass: savedStorageClass,
      }));
      await onRefreshBrowserObjects(itemSnapshot.key);
      if (!isPropertiesScopeCurrent()) return;
      pushStatus("Storage class updated.", "success");
    } catch (err) {
      pushStatus(
        extractApiError(err, "Unable to update storage class."),
        "error",
      );
    }
  };

  const handleSaveAcl = async () => {
    setActionMessage(null);
    try {
      if (!(await saveAcl()) || !isAclScopeCurrent()) return;
      pushStatus("ACL updated.", "success");
    } catch (err) {
      pushStatus(extractApiError(err, "Unable to update ACL."), "error");
    }
  };

  const handleSaveLegalHold = async () => {
    setActionMessage(null);
    try {
      if (!(await saveLegalHold()) || !isProtectionScopeCurrent()) return;
      pushStatus("Legal hold updated.", "success");
    } catch (err) {
      pushStatus(
        extractApiError(err, "Unable to update legal hold."),
        "error",
      );
    }
  };

  const handleSaveRetention = async () => {
    setActionMessage(null);
    try {
      const result = await saveRetention();
      if (result === "invalid") {
        pushStatus("Retention date is invalid.", "error");
        return;
      }
      if (result !== "saved" || !isProtectionScopeCurrent()) return;
      pushStatus("Retention updated.", "success");
    } catch (err) {
      pushStatus(
        extractApiError(err, "Unable to update retention."),
        "error",
      );
    }
  };

  const handleRestoreArchive = async () => {
    setActionMessage(null);
    try {
      const result = await restoreArchive();
      if (result === "invalid") {
        pushStatus("Restore days must be a positive number.", "error");
        return;
      }
      if (result !== "restored" || !isArchiveRestoreScopeCurrent()) return;
      await onRefreshBrowserObjects(itemSnapshot.key);
      if (!isArchiveRestoreScopeCurrent()) return;
      pushStatus("Restore request sent.", "success");
    } catch (err) {
      pushStatus(extractApiError(err, "Unable to restore object."), "error");
    }
  };

  const handleGeneratePresign = async () => {
    const result = await generatePresign();
    if (result.status === "generated") {
      pushStatus("Signed URL generated.", "success");
    } else if (result.status === "api-error") {
      pushStatus(result.message, "error");
    }
  };

  const handleCopyPresign = async () => {
    const result = await copyPresign();
    if (result.status === "copied") {
      pushStatus("URL copied to clipboard.", "success");
    } else if (result.status === "fallback") {
      setCopyDialogValue(result.value);
    }
  };

  const handleVersionAction = async (
    action: "restore" | "delete",
    version: BrowserObjectVersion,
  ) => {
    setActionMessage(null);
    if (!(await runVersionAction(action, version)) || !isVersionsScopeCurrent()) return;
    await loadProperties(true);
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
    <BrowserObjectVersionsTab
      versions={versionRows}
      loading={versionsLoading}
      savingAction={savingVersionAction}
      error={versionsError}
      canLoadMore={canLoadMoreVersions}
      onRefresh={() => void loadVersions({ force: true })}
      onLoadMore={() => void loadVersions({ append: true })}
      onRestoreVersion={(version) =>
        void handleVersionAction("restore", version)
      }
      onDeleteVersion={(version) =>
        void handleVersionAction("delete", version)
      }
      readOnly={readOnly}
    />
  );

  const renderPropertiesContent = () => (
    <BrowserObjectPropertiesTab
      readOnly={readOnly}
      loading={metadataLoading}
      loaded={metadataLoaded}
      error={metadataError}
      metadataDraft={metadataDraft}
      onMetadataDraftChange={updateMetadataDraft}
      savingMetadata={savingMetadata}
      onSaveMetadata={handleSaveMetadata}
      metadataItems={metadataItems}
      onAddMetadata={addMetadataItem}
      onMetadataItemChange={updateMetadataItem}
      onRemoveMetadata={removeMetadataItem}
      tags={tagsDraft}
      onAddTag={addTag}
      onTagChange={updateTag}
      onRemoveTag={removeTag}
      savingTags={savingTags}
      onSaveTags={handleSaveTags}
      storageClass={storageClass}
      onStorageClassChange={setStorageClass}
      savingStorageClass={savingStorage}
      onSaveStorageClass={handleSaveStorageClass}
      onRefresh={() => loadProperties(true)}
    />
  );

  const renderProtectionContent = () => (
    <BrowserObjectProtectionTab
      aclValue={aclValue}
      onAclChange={setAclValue}
      savingAcl={savingAcl}
      onSaveAcl={handleSaveAcl}
      protectionLoading={protectionLoading}
      objectLockUnavailable={objectLockUnavailable}
      legalHoldStatus={legalHoldStatus}
      onLegalHoldStatusChange={setLegalHoldStatus}
      legalHoldError={legalHoldError}
      savingLegalHold={savingLegalHold}
      onSaveLegalHold={handleSaveLegalHold}
      retentionMode={retentionMode}
      onRetentionModeChange={setRetentionMode}
      retentionDate={retentionDate}
      onRetentionDateChange={setRetentionDate}
      retentionBypass={retentionBypass}
      onRetentionBypassChange={setRetentionBypass}
      retentionError={retentionError}
      savingRetention={savingRetention}
      onSaveRetention={handleSaveRetention}
      sseCustomerKeyActive={Boolean(sseCustomerKeyBase64)}
      presignExpires={presignExpires}
      onPresignExpiresChange={setPresignExpires}
      presignError={presignError}
      savingPresign={savingPresign}
      presignUrl={presignUrl}
      presignMethod={presignMethod}
      presignHeaders={presignHeaders}
      onGeneratePresign={handleGeneratePresign}
      onCopyPresign={handleCopyPresign}
    />
  );

  const renderArchiveContent = () => (
    <BrowserObjectArchiveTab
      days={restoreDays}
      onDaysChange={setRestoreDays}
      tier={restoreTier}
      onTierChange={setRestoreTier}
      saving={savingRestore}
      onRestore={handleRestoreArchive}
      currentStorageClass={currentStorageClass}
      restoreStatusLabel={restoreStatusLabel}
    />
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
