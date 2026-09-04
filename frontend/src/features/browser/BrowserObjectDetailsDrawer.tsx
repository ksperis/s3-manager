/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useEffect, useMemo, useState } from "react";
import type { BrowserRequestOptions } from "../../api/browserWorkspace";
import PageBanner from "../../components/PageBanner";
import { useUnsavedChangesGuard } from "../../components/useUnsavedChangesGuard";
import { extractApiError } from "../../utils/apiError";
import ObjectPreview from "../shared/ObjectPreview";
import ObjectDetailsDrawer from "../shared/ObjectDetailsDrawer";
import { type BrowserObjectVersion } from "../../api/browserContracts";
import type {
  PresignedUrl,
  PresignRequest,
} from "../../api/browserTransfers";
import type { S3AccountSelector } from "../../api/accountParams";
import { BrowserCopyValueModal } from "./BrowserDialogModals";
import BrowserObjectArchiveTab from "./BrowserObjectArchiveTab";
import BrowserObjectReadOnlyDetailsTab, {
  BrowserObjectFactsCard,
} from "./BrowserObjectReadOnlyDetailsTab";
import BrowserObjectPropertiesTab from "./BrowserObjectPropertiesTab";
import BrowserObjectProtectionTab from "./BrowserObjectProtectionTab";
import BrowserObjectVersionsTab from "./BrowserObjectVersionsTab";
import {
  ARCHIVE_STORAGE_CLASSES,
  buildObjectDetailsTabs,
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

type BrowserObjectDetailsStatus = {
  message: string;
  tone: "success" | "error";
};

type BrowserObjectDetailsDrawerProps = {
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
  canDelete: boolean;
  presignObjectRequest: (
    targetBucket: string,
    payload: PresignRequest,
  ) => Promise<PresignedUrl>;
  onClose: () => void;
  onDownload: (item: BrowserItem) => void;
  onCopyUrl: (item: BrowserItem | null) => Promise<void> | void;
  onCopyPath: (path: string) => Promise<void> | void;
  onDelete: (item: BrowserItem) => Promise<void> | void;
  onDirtyChange?: (dirty: boolean) => void;
  onRefreshBrowserObjects: (targetKey: string) => Promise<void>;
  onRestoreVersion: (version: BrowserObjectVersion) => Promise<void> | void;
  onDeleteVersion: (version: BrowserObjectVersion) => Promise<void> | void;
  profile: "standard" | "advanced";
  requestOptions?: BrowserRequestOptions;
};

export default function BrowserObjectDetailsDrawer({
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
  canDelete,
  presignObjectRequest,
  onClose,
  onDownload,
  onCopyUrl,
  onCopyPath,
  onDelete,
  onDirtyChange,
  onRefreshBrowserObjects,
  onRestoreVersion,
  onDeleteVersion,
  profile,
  requestOptions,
}: BrowserObjectDetailsDrawerProps) {
  const [activeTab, setActiveTab] = useState<ObjectDetailsTabId>(initialTab);
  const [itemSnapshot, setItemSnapshot] = useState(item);
  const [actionStatus, setActionStatus] =
    useState<BrowserObjectDetailsStatus | null>(null);
  const [copyDialogValue, setCopyDialogValue] = useState<string | null>(null);
  const readOnly = profile === "standard";
  const canCopyUrl = profile === "advanced";

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
    hasUnsavedChanges,
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
  const pushStatus = (message: string, tone: "success" | "error") => {
    setActionStatus({ message, tone });
  };

  const runBooleanSave = async ({
    save,
    isCurrentScope,
    successMessage,
    errorMessage,
    refreshObjectList = false,
  }: {
    save: () => Promise<boolean>;
    isCurrentScope: () => boolean;
    successMessage: string;
    errorMessage: string;
    refreshObjectList?: boolean;
  }) => {
    setActionStatus(null);
    try {
      if (!(await save()) || !isCurrentScope()) return;
      if (refreshObjectList) {
        await onRefreshBrowserObjects(itemSnapshot.key);
        if (!isCurrentScope()) return;
      }
      pushStatus(successMessage, "success");
    } catch (err) {
      pushStatus(extractApiError(err, errorMessage), "error");
    }
  };

  const closeGuard = useUnsavedChangesGuard({
    hasUnsavedChanges,
    onClose,
    description:
      "You have unapplied object property changes. Closing details will discard them.",
  });

  useEffect(() => {
    onDirtyChange?.(hasUnsavedChanges);
    return () => onDirtyChange?.(false);
  }, [hasUnsavedChanges, onDirtyChange]);

  useEffect(() => {
    setItemSnapshot(item);
    setActiveTab(initialTab);
    setActionStatus(null);
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
      (activeTab === "details" ||
        activeTab === "properties" ||
        activeTab === "archive") &&
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

  const handleSaveMetadata = () =>
    runBooleanSave({
      save: saveMetadata,
      isCurrentScope: isPropertiesScopeCurrent,
      successMessage: "Metadata updated.",
      errorMessage: "Unable to update metadata.",
      refreshObjectList: true,
    });

  const handleSaveTags = () =>
    runBooleanSave({
      save: saveTags,
      isCurrentScope: isPropertiesScopeCurrent,
      successMessage: "Tags updated.",
      errorMessage: "Unable to update tags.",
      refreshObjectList: true,
    });

  const handleSaveStorageClass = async () => {
    setActionStatus(null);
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

  const handleSaveAcl = () =>
    runBooleanSave({
      save: saveAcl,
      isCurrentScope: isAclScopeCurrent,
      successMessage: "ACL updated.",
      errorMessage: "Unable to update ACL.",
    });

  const handleSaveLegalHold = () =>
    runBooleanSave({
      save: saveLegalHold,
      isCurrentScope: isProtectionScopeCurrent,
      successMessage: "Legal hold updated.",
      errorMessage: "Unable to update legal hold.",
    });

  const handleSaveRetention = async () => {
    setActionStatus(null);
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
    setActionStatus(null);
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
    setActionStatus(null);
    if (!(await runVersionAction(action, version)) || !isVersionsScopeCurrent()) return;
    await loadProperties(true);
  };

  const tabs = useMemo(
    () =>
      buildObjectDetailsTabs({
        hasArchiveTab,
        isDeleted: isDeletedCurrent,
        profile,
        versioningEnabled,
      }),
    [hasArchiveTab, isDeletedCurrent, profile, versioningEnabled],
  );

  useEffect(() => {
    if (tabs.some((tab) => tab.id === activeTab)) return;
    setActiveTab(tabs[0]?.id ?? "preview");
  }, [activeTab, tabs]);

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
    <div className="space-y-4">
      <BrowserObjectFactsCard
        bucketName={bucketName}
        item={itemSnapshot}
        metadata={metadata}
      />
      <BrowserObjectPropertiesTab
        readOnly={false}
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
    </div>
  );

  const renderReadOnlyDetailsContent = () => (
    <BrowserObjectReadOnlyDetailsTab
      bucketName={bucketName}
      item={itemSnapshot}
      metadata={metadata}
      tags={tagsDraft}
      loading={metadataLoading}
      loaded={metadataLoaded}
      error={metadataError}
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
          <PageBanner tone="warning">
            Latest state is deleted. Use <span className="font-bold">Versions</span> to
            restore the object or remove the delete marker.
          </PageBanner>
          {versioningEnabled ? renderVersionsContent() : null}
        </div>
      );
    }

    switch (activeTab) {
      case "preview":
        return renderPreviewContent();
      case "details":
        return renderReadOnlyDetailsContent();
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

  const path = `${bucketName}/${itemSnapshot.key}`;
  const statusNotice = actionStatus ? (
    <PageBanner tone={actionStatus.tone}>
      {actionStatus.message}
    </PageBanner>
  ) : null;

  return (
    <>
      <ObjectDetailsDrawer
        name={itemSnapshot.name}
        path={path}
        copyPathLabel="Copy path"
        moreLabel="More"
        onCopyPath={() => void onCopyPath(path)}
        primaryAction={
          !isDeletedCurrent
            ? { label: "Download", onSelect: () => onDownload(itemSnapshot) }
            : undefined
        }
        secondaryActions={
          !isDeletedCurrent
            ? [
                ...(canCopyUrl
                  ? [{
                      id: "copy-url",
                      label: "Copy URL",
                      disabled: copyUrlDisabled,
                      title: copyUrlDisabled ? copyUrlDisabledReason : undefined,
                      onSelect: () => void onCopyUrl(itemSnapshot),
                    }]
                  : []),
                ...(canDelete
                  ? [{
                      id: "delete",
                      label: "Delete",
                      tone: "danger" as const,
                      onSelect: () => void onDelete(itemSnapshot),
                    }]
                  : []),
              ]
            : []
        }
        activeTab={activeTab}
        tabs={tabs}
        tabsAriaLabel="Object details views"
        onTabChange={(tab) => setActiveTab(tab as ObjectDetailsTabId)}
        notice={
          isDeletedCurrent || restoreStatusLabel || statusNotice ? (
            <div className="space-y-2">
              {isDeletedCurrent || restoreStatusLabel ? (
                <div className="flex flex-wrap gap-2 ui-caption text-[var(--ui-text-muted)]">
                  {isDeletedCurrent ? <span className="rounded-md bg-rose-50 px-2 py-1 font-semibold text-rose-700 dark:bg-rose-900/30 dark:text-rose-100">Deleted</span> : null}
                  {restoreStatusLabel ? <span className="rounded-md bg-amber-50 px-2 py-1 font-semibold text-amber-700 dark:bg-amber-900/20 dark:text-amber-100">{restoreStatusLabel}</span> : null}
                </div>
              ) : null}
              {statusNotice}
            </div>
          ) : undefined
        }
        onClose={closeGuard.requestClose}
      >
        {renderContent()}
      </ObjectDetailsDrawer>

      {copyDialogValue && (
        <BrowserCopyValueModal
          title="Copy URL"
          label="Signed URL"
          value={copyDialogValue}
          onCopySuccess={() => pushStatus("URL copied to clipboard.", "success")}
          onClose={() => setCopyDialogValue(null)}
        />
      )}
      {closeGuard.confirmationDialog}
    </>
  );
}
