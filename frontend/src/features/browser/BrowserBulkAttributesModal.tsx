/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import type { Dispatch, SetStateAction } from "react";
import Modal from "../../components/Modal";
import {
  aclOptions,
  bulkActionClasses,
  formInputClasses,
  storageClassOptions,
  toolbarPrimaryClasses,
} from "./browserConstants";
import type { BulkMetadataDraft } from "./browserTypes";

type Setter<T> = Dispatch<SetStateAction<T>>;

type BrowserBulkAttributesModalProps = {
  bulkActionFileCount: number;
  bulkActionFolderCount: number;
  bulkAttributesError: string | null;
  bulkAttributesSummary: string | null;
  bulkApplyMetadata: boolean;
  setBulkApplyMetadata: Setter<boolean>;
  bulkMetadataDraft: BulkMetadataDraft;
  setBulkMetadataDraft: Setter<BulkMetadataDraft>;
  bulkMetadataEntries: string;
  setBulkMetadataEntries: Setter<string>;
  bulkApplyTags: boolean;
  setBulkApplyTags: Setter<boolean>;
  bulkTagsDraft: string;
  setBulkTagsDraft: Setter<string>;
  bulkApplyStorageClass: boolean;
  setBulkApplyStorageClass: Setter<boolean>;
  bulkStorageClass: string;
  setBulkStorageClass: Setter<string>;
  bulkApplyAcl: boolean;
  setBulkApplyAcl: Setter<boolean>;
  bulkAclValue: string;
  setBulkAclValue: Setter<string>;
  bulkApplyLegalHold: boolean;
  setBulkApplyLegalHold: Setter<boolean>;
  bulkLegalHoldStatus: "ON" | "OFF";
  setBulkLegalHoldStatus: Setter<"ON" | "OFF">;
  bulkApplyRetention: boolean;
  setBulkApplyRetention: Setter<boolean>;
  bulkRetentionMode: "" | "GOVERNANCE" | "COMPLIANCE";
  setBulkRetentionMode: Setter<"" | "GOVERNANCE" | "COMPLIANCE">;
  bulkRetentionDate: string;
  setBulkRetentionDate: Setter<string>;
  bulkRetentionBypass: boolean;
  setBulkRetentionBypass: Setter<boolean>;
  bulkAttributesLoading: boolean;
  onApply: () => void;
  onClose: () => void;
};

export default function BrowserBulkAttributesModal({
  bulkActionFileCount,
  bulkActionFolderCount,
  bulkAttributesError,
  bulkAttributesSummary,
  bulkApplyMetadata,
  setBulkApplyMetadata,
  bulkMetadataDraft,
  setBulkMetadataDraft,
  bulkMetadataEntries,
  setBulkMetadataEntries,
  bulkApplyTags,
  setBulkApplyTags,
  bulkTagsDraft,
  setBulkTagsDraft,
  bulkApplyStorageClass,
  setBulkApplyStorageClass,
  bulkStorageClass,
  setBulkStorageClass,
  bulkApplyAcl,
  setBulkApplyAcl,
  bulkAclValue,
  setBulkAclValue,
  bulkApplyLegalHold,
  setBulkApplyLegalHold,
  bulkLegalHoldStatus,
  setBulkLegalHoldStatus,
  bulkApplyRetention,
  setBulkApplyRetention,
  bulkRetentionMode,
  setBulkRetentionMode,
  bulkRetentionDate,
  setBulkRetentionDate,
  bulkRetentionBypass,
  setBulkRetentionBypass,
  bulkAttributesLoading,
  onApply,
  onClose,
}: BrowserBulkAttributesModalProps) {
  return (
    <Modal title="Bulk attributes" onClose={onClose} maxWidthClass="max-w-3xl">
      <div className="space-y-4 ui-caption text-slate-600 dark:text-slate-300">
        <div className="space-y-1">
          <p className="font-semibold text-slate-800 dark:text-slate-100">Targets</p>
          <p>
            {bulkActionFileCount} file(s) · {bulkActionFolderCount} folder(s)
            {bulkActionFolderCount > 0 && " (folders expanded to files)"}
          </p>
        </div>
        {bulkAttributesError && (
          <p className="font-semibold text-rose-600 dark:text-rose-200">{bulkAttributesError}</p>
        )}
        {bulkAttributesSummary && (
          <p className="font-semibold text-emerald-600 dark:text-emerald-200">{bulkAttributesSummary}</p>
        )}
        <div className="space-y-3">
          <div className="rounded-lg border border-slate-200 p-3 dark:border-slate-800">
            <label className="flex items-center gap-2 font-semibold text-slate-700 dark:text-slate-200">
              <input
                type="checkbox"
                checked={bulkApplyMetadata}
                onChange={(event) => setBulkApplyMetadata(event.target.checked)}
                className="h-4 w-4 rounded border-slate-300 text-primary focus:ring-primary dark:border-slate-600"
              />
              Metadata headers
            </label>
            {bulkApplyMetadata && (
              <div className="mt-3 grid gap-2">
                <input
                  className={formInputClasses}
                  placeholder="Content-Type"
                  value={bulkMetadataDraft.contentType}
                  onChange={(event) =>
                    setBulkMetadataDraft((prev) => ({ ...prev, contentType: event.target.value }))
                  }
                />
                <input
                  className={formInputClasses}
                  placeholder="Cache-Control"
                  value={bulkMetadataDraft.cacheControl}
                  onChange={(event) =>
                    setBulkMetadataDraft((prev) => ({ ...prev, cacheControl: event.target.value }))
                  }
                />
                <input
                  className={formInputClasses}
                  placeholder="Content-Disposition"
                  value={bulkMetadataDraft.contentDisposition}
                  onChange={(event) =>
                    setBulkMetadataDraft((prev) => ({ ...prev, contentDisposition: event.target.value }))
                  }
                />
                <input
                  className={formInputClasses}
                  placeholder="Content-Encoding"
                  value={bulkMetadataDraft.contentEncoding}
                  onChange={(event) =>
                    setBulkMetadataDraft((prev) => ({ ...prev, contentEncoding: event.target.value }))
                  }
                />
                <input
                  className={formInputClasses}
                  placeholder="Content-Language"
                  value={bulkMetadataDraft.contentLanguage}
                  onChange={(event) =>
                    setBulkMetadataDraft((prev) => ({ ...prev, contentLanguage: event.target.value }))
                  }
                />
                <input
                  type="datetime-local"
                  className={formInputClasses}
                  placeholder="Expires"
                  value={bulkMetadataDraft.expires}
                  onChange={(event) =>
                    setBulkMetadataDraft((prev) => ({ ...prev, expires: event.target.value }))
                  }
                />
                <div className="space-y-1">
                  <p className="ui-caption font-semibold text-slate-500 dark:text-slate-400">
                    Custom metadata (key=value per line)
                  </p>
                  <textarea
                    rows={3}
                    className={formInputClasses}
                    value={bulkMetadataEntries}
                    onChange={(event) => setBulkMetadataEntries(event.target.value)}
                  />
                </div>
              </div>
            )}
          </div>
          <div className="rounded-lg border border-slate-200 p-3 dark:border-slate-800">
            <label className="flex items-center gap-2 font-semibold text-slate-700 dark:text-slate-200">
              <input
                type="checkbox"
                checked={bulkApplyTags}
                onChange={(event) => setBulkApplyTags(event.target.checked)}
                className="h-4 w-4 rounded border-slate-300 text-primary focus:ring-primary dark:border-slate-600"
              />
              Tags (key=value per line)
            </label>
            {bulkApplyTags && (
              <textarea
                rows={3}
                className={`${formInputClasses} mt-3`}
                value={bulkTagsDraft}
                onChange={(event) => setBulkTagsDraft(event.target.value)}
              />
            )}
          </div>
          <div className="rounded-lg border border-slate-200 p-3 dark:border-slate-800">
            <label className="flex items-center gap-2 font-semibold text-slate-700 dark:text-slate-200">
              <input
                type="checkbox"
                checked={bulkApplyStorageClass}
                onChange={(event) => setBulkApplyStorageClass(event.target.checked)}
                className="h-4 w-4 rounded border-slate-300 text-primary focus:ring-primary dark:border-slate-600"
              />
              Storage class
            </label>
            {bulkApplyStorageClass && (
              <select
                className={`${formInputClasses} mt-3`}
                value={bulkStorageClass}
                onChange={(event) => setBulkStorageClass(event.target.value)}
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
          <div className="rounded-lg border border-slate-200 p-3 dark:border-slate-800">
            <label className="flex items-center gap-2 font-semibold text-slate-700 dark:text-slate-200">
              <input
                type="checkbox"
                checked={bulkApplyAcl}
                onChange={(event) => setBulkApplyAcl(event.target.checked)}
                className="h-4 w-4 rounded border-slate-300 text-primary focus:ring-primary dark:border-slate-600"
              />
              ACL
            </label>
            {bulkApplyAcl && (
              <select
                className={`${formInputClasses} mt-3`}
                value={bulkAclValue}
                onChange={(event) => setBulkAclValue(event.target.value)}
              >
                {aclOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            )}
          </div>
          <div className="rounded-lg border border-slate-200 p-3 dark:border-slate-800">
            <label className="flex items-center gap-2 font-semibold text-slate-700 dark:text-slate-200">
              <input
                type="checkbox"
                checked={bulkApplyLegalHold}
                onChange={(event) => setBulkApplyLegalHold(event.target.checked)}
                className="h-4 w-4 rounded border-slate-300 text-primary focus:ring-primary dark:border-slate-600"
              />
              Legal hold
            </label>
            {bulkApplyLegalHold && (
              <select
                className={`${formInputClasses} mt-3`}
                value={bulkLegalHoldStatus}
                onChange={(event) => setBulkLegalHoldStatus(event.target.value as "ON" | "OFF")}
              >
                <option value="OFF">OFF</option>
                <option value="ON">ON</option>
              </select>
            )}
          </div>
          <div className="rounded-lg border border-slate-200 p-3 dark:border-slate-800">
            <label className="flex items-center gap-2 font-semibold text-slate-700 dark:text-slate-200">
              <input
                type="checkbox"
                checked={bulkApplyRetention}
                onChange={(event) => setBulkApplyRetention(event.target.checked)}
                className="h-4 w-4 rounded border-slate-300 text-primary focus:ring-primary dark:border-slate-600"
              />
              Retention
            </label>
            {bulkApplyRetention && (
              <div className="mt-3 grid gap-2">
                <select
                  className={formInputClasses}
                  value={bulkRetentionMode}
                  onChange={(event) =>
                    setBulkRetentionMode(event.target.value as "" | "GOVERNANCE" | "COMPLIANCE")
                  }
                >
                  <option value="">Select mode</option>
                  <option value="GOVERNANCE">GOVERNANCE</option>
                  <option value="COMPLIANCE">COMPLIANCE</option>
                </select>
                <input
                  type="datetime-local"
                  className={formInputClasses}
                  value={bulkRetentionDate}
                  onChange={(event) => setBulkRetentionDate(event.target.value)}
                />
                <label className="flex items-center gap-2 ui-caption text-slate-500 dark:text-slate-400">
                  <input
                    type="checkbox"
                    checked={bulkRetentionBypass}
                    onChange={(event) => setBulkRetentionBypass(event.target.checked)}
                    className="h-4 w-4 rounded border-slate-300 text-primary focus:ring-primary dark:border-slate-600"
                  />
                  Bypass governance
                </label>
              </div>
            )}
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <button type="button" className={bulkActionClasses} onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className={toolbarPrimaryClasses}
            onClick={onApply}
            disabled={bulkAttributesLoading}
          >
            {bulkAttributesLoading ? "Updating..." : "Apply changes"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
