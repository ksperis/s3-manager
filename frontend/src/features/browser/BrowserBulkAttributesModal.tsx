/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useMemo, useState, type Dispatch, type SetStateAction } from "react";
import Modal from "../../components/Modal";
import { useUnsavedChangesGuard } from "../../components/useUnsavedChangesGuard";
import UiCheckboxField from "../../components/ui/UiCheckboxField";
import UiInlineMessage from "../../components/ui/UiInlineMessage";
import { stableSignature } from "../../utils/stableSignature";
import {
  aclOptions,
  browserPanelCardClasses,
  bulkActionClasses,
  formInputClasses,
  storageClassOptions,
  toolbarPrimaryClasses,
} from "./browserConstants";
import type { BrowserBulkAttributesDraft } from "./useBrowserBulkAttributes";

type BrowserBulkAttributesModalProps = {
  draft: BrowserBulkAttributesDraft;
  error: string | null;
  fileCount: number;
  folderCount: number;
  loading: boolean;
  onApply: () => void;
  onClose: () => void;
  setDraft: Dispatch<SetStateAction<BrowserBulkAttributesDraft>>;
  summary: string | null;
};

export default function BrowserBulkAttributesModal({
  draft,
  error,
  fileCount,
  folderCount,
  loading,
  onApply,
  onClose,
  setDraft,
  summary,
}: BrowserBulkAttributesModalProps) {
  const currentSignature = useMemo(() => stableSignature(draft), [draft]);
  const [initialSignature] = useState(currentSignature);
  const closeGuard = useUnsavedChangesGuard({
    hasUnsavedChanges: currentSignature !== initialSignature,
    onClose,
    disabled: loading,
  });
  const updateDraft = <Key extends keyof BrowserBulkAttributesDraft>(
    key: Key,
    value: BrowserBulkAttributesDraft[Key],
  ) => setDraft((previous) => ({ ...previous, [key]: value }));
  const updateMetadata = (
    key: keyof BrowserBulkAttributesDraft["metadata"],
    value: string,
  ) =>
    setDraft((previous) => ({
      ...previous,
      metadata: { ...previous.metadata, [key]: value },
    }));

  return (
    <Modal title="Bulk attributes" onClose={closeGuard.requestClose} maxWidthClass="max-w-3xl">
      <div className="space-y-4 ui-caption text-slate-600 dark:text-slate-300">
        <div className="space-y-1">
          <p className="font-semibold text-slate-800 dark:text-slate-100">Targets</p>
          <p>
            {fileCount} file(s) · {folderCount} folder(s)
            {folderCount > 0 && " (folders expanded to files)"}
          </p>
        </div>
        {error && <UiInlineMessage tone="error">{error}</UiInlineMessage>}
        {summary && <UiInlineMessage tone="success">{summary}</UiInlineMessage>}
        <div className="space-y-3">
          <div className={browserPanelCardClasses}>
            <UiCheckboxField
              checked={draft.applyMetadata}
              onChange={(event) => updateDraft("applyMetadata", event.target.checked)}
              className="font-semibold text-slate-700 dark:text-slate-200"
            >
              Metadata headers
            </UiCheckboxField>
            {draft.applyMetadata && (
              <div className="mt-3 grid gap-2">
                <input
                  className={formInputClasses}
                  placeholder="Content-Type"
                  value={draft.metadata.contentType}
                  onChange={(event) => updateMetadata("contentType", event.target.value)}
                />
                <input
                  className={formInputClasses}
                  placeholder="Cache-Control"
                  value={draft.metadata.cacheControl}
                  onChange={(event) => updateMetadata("cacheControl", event.target.value)}
                />
                <input
                  className={formInputClasses}
                  placeholder="Content-Disposition"
                  value={draft.metadata.contentDisposition}
                  onChange={(event) => updateMetadata("contentDisposition", event.target.value)}
                />
                <input
                  className={formInputClasses}
                  placeholder="Content-Encoding"
                  value={draft.metadata.contentEncoding}
                  onChange={(event) => updateMetadata("contentEncoding", event.target.value)}
                />
                <input
                  className={formInputClasses}
                  placeholder="Content-Language"
                  value={draft.metadata.contentLanguage}
                  onChange={(event) => updateMetadata("contentLanguage", event.target.value)}
                />
                <input
                  type="datetime-local"
                  className={formInputClasses}
                  placeholder="Expires"
                  value={draft.metadata.expires}
                  onChange={(event) => updateMetadata("expires", event.target.value)}
                />
                <div className="space-y-1">
                  <p className="ui-caption font-semibold text-slate-500 dark:text-slate-400">
                    Custom metadata (key=value per line)
                  </p>
                  <textarea
                    rows={3}
                    className={formInputClasses}
                    value={draft.metadataEntries}
                    onChange={(event) => updateDraft("metadataEntries", event.target.value)}
                  />
                </div>
              </div>
            )}
          </div>
          <div className={browserPanelCardClasses}>
            <UiCheckboxField
              checked={draft.applyTags}
              onChange={(event) => updateDraft("applyTags", event.target.checked)}
              className="font-semibold text-slate-700 dark:text-slate-200"
            >
              Tags (key=value per line)
            </UiCheckboxField>
            {draft.applyTags && (
              <textarea
                rows={3}
                className={`${formInputClasses} mt-3`}
                value={draft.tags}
                onChange={(event) => updateDraft("tags", event.target.value)}
              />
            )}
          </div>
          <div className={browserPanelCardClasses}>
            <UiCheckboxField
              checked={draft.applyStorageClass}
              onChange={(event) => updateDraft("applyStorageClass", event.target.checked)}
              className="font-semibold text-slate-700 dark:text-slate-200"
            >
              Storage class
            </UiCheckboxField>
            {draft.applyStorageClass && (
              <select
                className={`${formInputClasses} mt-3`}
                value={draft.storageClass}
                onChange={(event) => updateDraft("storageClass", event.target.value)}
              >
                <option value="">Select storage class</option>
                {storageClassOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            )}
          </div>
          <div className={browserPanelCardClasses}>
            <UiCheckboxField
              checked={draft.applyAcl}
              onChange={(event) => updateDraft("applyAcl", event.target.checked)}
              className="font-semibold text-slate-700 dark:text-slate-200"
            >
              ACL
            </UiCheckboxField>
            {draft.applyAcl && (
              <select
                className={`${formInputClasses} mt-3`}
                value={draft.aclValue}
                onChange={(event) => updateDraft("aclValue", event.target.value)}
              >
                {aclOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            )}
          </div>
          <div className={browserPanelCardClasses}>
            <UiCheckboxField
              checked={draft.applyLegalHold}
              onChange={(event) => updateDraft("applyLegalHold", event.target.checked)}
              className="font-semibold text-slate-700 dark:text-slate-200"
            >
              Legal hold
            </UiCheckboxField>
            {draft.applyLegalHold && (
              <select
                className={`${formInputClasses} mt-3`}
                value={draft.legalHoldStatus}
                onChange={(event) => updateDraft("legalHoldStatus", event.target.value as "ON" | "OFF")}
              >
                <option value="OFF">OFF</option>
                <option value="ON">ON</option>
              </select>
            )}
          </div>
          <div className={browserPanelCardClasses}>
            <UiCheckboxField
              checked={draft.applyRetention}
              onChange={(event) => updateDraft("applyRetention", event.target.checked)}
              className="font-semibold text-slate-700 dark:text-slate-200"
            >
              Retention
            </UiCheckboxField>
            {draft.applyRetention && (
              <div className="mt-3 grid gap-2">
                <select
                  className={formInputClasses}
                  value={draft.retentionMode}
                  onChange={(event) =>
                    updateDraft("retentionMode", event.target.value as "" | "GOVERNANCE" | "COMPLIANCE")
                  }
                >
                  <option value="">Select mode</option>
                  <option value="GOVERNANCE">GOVERNANCE</option>
                  <option value="COMPLIANCE">COMPLIANCE</option>
                </select>
                <input
                  type="datetime-local"
                  className={formInputClasses}
                  value={draft.retentionDate}
                  onChange={(event) => updateDraft("retentionDate", event.target.value)}
                />
                <UiCheckboxField
                  checked={draft.retentionBypass}
                  onChange={(event) => updateDraft("retentionBypass", event.target.checked)}
                  className="ui-caption text-slate-500 dark:text-slate-400"
                >
                  Bypass governance
                </UiCheckboxField>
              </div>
            )}
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <button type="button" className={bulkActionClasses} onClick={closeGuard.requestClose}>
            Cancel
          </button>
          <button
            type="button"
            className={toolbarPrimaryClasses}
            onClick={onApply}
            disabled={loading}
          >
            {loading ? "Updating..." : "Apply changes"}
          </button>
        </div>
      </div>
      {closeGuard.confirmationDialog}
    </Modal>
  );
}
