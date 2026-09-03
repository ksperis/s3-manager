/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import type { PresignedUrl } from "../../api/browserTransfers";
import UiCheckboxField from "../../components/ui/UiCheckboxField";
import {
  aclOptions,
  browserPanelCardClasses,
  formInputClasses,
  toolbarButtonClasses,
  toolbarPrimaryClasses,
} from "./browserConstants";
import { OBJECT_LOCK_DISABLED_MESSAGE } from "./browserObjectDetailsModel";
import type { ObjectRetentionMode } from "./useBrowserObjectProtection";

type BrowserObjectProtectionTabProps = {
  aclValue: string;
  legalHoldError: string | null;
  legalHoldStatus: "ON" | "OFF";
  objectLockUnavailable: boolean;
  onAclChange: (value: string) => void;
  onCopyPresign: () => Promise<void> | void;
  onGeneratePresign: () => Promise<void> | void;
  onLegalHoldStatusChange: (value: "ON" | "OFF") => void;
  onPresignExpiresChange: (value: string) => void;
  onRetentionBypassChange: (value: boolean) => void;
  onRetentionDateChange: (value: string) => void;
  onRetentionModeChange: (value: ObjectRetentionMode) => void;
  onSaveAcl: () => Promise<void> | void;
  onSaveLegalHold: () => Promise<void> | void;
  onSaveRetention: () => Promise<void> | void;
  presignError: string | null;
  presignExpires: string;
  presignHeaders?: PresignedUrl["headers"] | null;
  presignMethod: string;
  presignUrl: string;
  protectionLoading: boolean;
  retentionBypass: boolean;
  retentionDate: string;
  retentionError: string | null;
  retentionMode: ObjectRetentionMode;
  savingAcl: boolean;
  savingLegalHold: boolean;
  savingPresign: boolean;
  savingRetention: boolean;
  sseCustomerKeyActive: boolean;
};

export default function BrowserObjectProtectionTab({
  aclValue,
  legalHoldError,
  legalHoldStatus,
  objectLockUnavailable,
  onAclChange,
  onCopyPresign,
  onGeneratePresign,
  onLegalHoldStatusChange,
  onPresignExpiresChange,
  onRetentionBypassChange,
  onRetentionDateChange,
  onRetentionModeChange,
  onSaveAcl,
  onSaveLegalHold,
  onSaveRetention,
  presignError,
  presignExpires,
  presignHeaders,
  presignMethod,
  presignUrl,
  protectionLoading,
  retentionBypass,
  retentionDate,
  retentionError,
  retentionMode,
  savingAcl,
  savingLegalHold,
  savingPresign,
  savingRetention,
  sseCustomerKeyActive,
}: BrowserObjectProtectionTabProps) {
  return (
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
            onChange={(event) => onAclChange(event.target.value)}
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
            onClick={() => void onSaveAcl()}
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
              onLegalHoldStatusChange(event.target.value as "ON" | "OFF")
            }
            disabled={objectLockUnavailable}
          >
            <option value="OFF">OFF</option>
            <option value="ON">ON</option>
          </select>
          <button
            type="button"
            className={toolbarPrimaryClasses}
            onClick={() => void onSaveLegalHold()}
            disabled={
              savingLegalHold || protectionLoading || objectLockUnavailable
            }
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
                onRetentionModeChange(
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
              onChange={(event) => onRetentionDateChange(event.target.value)}
              disabled={objectLockUnavailable}
            />
          </label>
        </div>
        <UiCheckboxField
          checked={retentionBypass}
          onChange={(event) =>
            onRetentionBypassChange(event.target.checked)
          }
          disabled={objectLockUnavailable}
          className="mt-2 ui-caption text-slate-500 dark:text-slate-400"
        >
          Bypass governance retention
        </UiCheckboxField>
        <div className="mt-3 flex items-center justify-end">
          <button
            type="button"
            className={toolbarPrimaryClasses}
            onClick={() => void onSaveRetention()}
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
        {sseCustomerKeyActive && (
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
            onChange={(event) => onPresignExpiresChange(event.target.value)}
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
            onClick={() => void onGeneratePresign()}
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
                onClick={() => void onCopyPresign()}
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
}
