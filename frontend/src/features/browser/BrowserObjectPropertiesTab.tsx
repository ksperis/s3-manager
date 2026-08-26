/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import type { ReactNode } from "react";
import {
  browserPanelCardClasses,
  formInputClasses,
  storageClassOptions,
  toolbarButtonClasses,
  toolbarPrimaryClasses,
} from "./browserConstants";
import type {
  BrowserObjectMetadataDraft,
  BrowserObjectPropertyEntry,
  BrowserObjectPropertyEntryField,
} from "./useBrowserObjectProperties";

type AsyncAction = () => Promise<unknown> | void;

type EditablePairsCardProps = {
  addLabel: string;
  emptyLabel: string;
  entries: BrowserObjectPropertyEntry[];
  footer?: ReactNode;
  keyPlaceholder: string;
  onAdd: () => void;
  onChange: (
    id: string,
    field: BrowserObjectPropertyEntryField,
    value: string,
  ) => void;
  onRemove: (id: string) => void;
  title: string;
  valuePlaceholder: string;
};

const standardMetadataFields: Array<{
  field: keyof BrowserObjectMetadataDraft;
  label: string;
  placeholder?: string;
  type?: "datetime-local";
}> = [
  {
    field: "contentType",
    label: "Content type",
    placeholder: "application/octet-stream",
  },
  {
    field: "cacheControl",
    label: "Cache control",
    placeholder: "max-age=3600",
  },
  {
    field: "contentDisposition",
    label: "Content disposition",
    placeholder: "inline",
  },
  {
    field: "contentEncoding",
    label: "Content encoding",
    placeholder: "gzip",
  },
  {
    field: "contentLanguage",
    label: "Content language",
    placeholder: "en",
  },
  { field: "expires", label: "Expires", type: "datetime-local" },
];

function EditablePairsCard({
  addLabel,
  emptyLabel,
  entries,
  footer,
  keyPlaceholder,
  onAdd,
  onChange,
  onRemove,
  title,
  valuePlaceholder,
}: EditablePairsCardProps) {
  return (
    <div className={browserPanelCardClasses}>
      <div className="flex items-center justify-between">
        <p className="ui-caption font-semibold uppercase tracking-wide text-slate-400">
          {title}
        </p>
        <button
          type="button"
          className={toolbarButtonClasses}
          onClick={onAdd}
        >
          {addLabel}
        </button>
      </div>
      {entries.length === 0 ? (
        <p className="mt-2 ui-caption text-slate-500 dark:text-slate-400">
          {emptyLabel}
        </p>
      ) : (
        <div className="mt-2 space-y-2">
          {entries.map((entry, index) => (
            <div
              key={entry.id}
              className="grid gap-2 md:grid-cols-[1fr_1fr_auto]"
            >
              <input
                aria-label={`${title} key ${index + 1}`}
                className={formInputClasses}
                value={entry.key}
                onChange={(event) =>
                  onChange(entry.id, "key", event.target.value)
                }
                placeholder={keyPlaceholder}
              />
              <input
                aria-label={`${title} value ${index + 1}`}
                className={formInputClasses}
                value={entry.value}
                onChange={(event) =>
                  onChange(entry.id, "value", event.target.value)
                }
                placeholder={valuePlaceholder}
              />
              <button
                type="button"
                className={toolbarButtonClasses}
                onClick={() => onRemove(entry.id)}
              >
                Remove
              </button>
            </div>
          ))}
        </div>
      )}
      {footer}
    </div>
  );
}

type BrowserObjectPropertiesTabProps = {
  error: string | null;
  loaded: boolean;
  loading: boolean;
  metadataDraft: BrowserObjectMetadataDraft;
  metadataItems: BrowserObjectPropertyEntry[];
  onAddMetadata: () => void;
  onAddTag: () => void;
  onMetadataDraftChange: (
    field: keyof BrowserObjectMetadataDraft,
    value: string,
  ) => void;
  onMetadataItemChange: EditablePairsCardProps["onChange"];
  onRefresh: AsyncAction;
  onRemoveMetadata: (id: string) => void;
  onRemoveTag: (id: string) => void;
  onSaveMetadata: AsyncAction;
  onSaveStorageClass: AsyncAction;
  onSaveTags: AsyncAction;
  onStorageClassChange: (value: string) => void;
  onTagChange: EditablePairsCardProps["onChange"];
  readOnly: boolean;
  savingMetadata: boolean;
  savingStorageClass: boolean;
  savingTags: boolean;
  storageClass: string;
  tags: BrowserObjectPropertyEntry[];
};

export default function BrowserObjectPropertiesTab({
  error,
  loaded,
  loading,
  metadataDraft,
  metadataItems,
  onAddMetadata,
  onAddTag,
  onMetadataDraftChange,
  onMetadataItemChange,
  onRefresh,
  onRemoveMetadata,
  onRemoveTag,
  onSaveMetadata,
  onSaveStorageClass,
  onSaveTags,
  onStorageClassChange,
  onTagChange,
  readOnly,
  savingMetadata,
  savingStorageClass,
  savingTags,
  storageClass,
  tags,
}: BrowserObjectPropertiesTabProps) {
  return (
    <>
      {readOnly && (
        <p className="mb-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 ui-caption text-slate-600 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-300">
          Properties are read-only in the Standard Browser profile.
        </p>
      )}
      <fieldset disabled={readOnly} className="space-y-4">
        {loading && !loaded && (
          <p className="ui-caption text-slate-500 dark:text-slate-400">
            Loading object details...
          </p>
        )}
        {error && (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 ui-caption font-semibold text-rose-700 dark:border-rose-500/30 dark:bg-rose-900/30 dark:text-rose-100">
            <span>{error}</span>
            <button
              type="button"
              className={toolbarButtonClasses}
              onClick={() => void onRefresh()}
              disabled={loading}
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
                  onClick={() => void onRefresh()}
                  disabled={loading}
                >
                  Refresh
                </button>
              </div>
              <div className="mt-3 grid gap-3 md:grid-cols-2">
                {standardMetadataFields.map(
                  ({ field, label, placeholder, type }) => (
                    <label
                      key={field}
                      className="space-y-1 ui-caption font-semibold text-slate-600 dark:text-slate-300"
                    >
                      <span>{label}</span>
                      <input
                        type={type}
                        className={formInputClasses}
                        value={metadataDraft[field]}
                        onChange={(event) =>
                          onMetadataDraftChange(field, event.target.value)
                        }
                        placeholder={placeholder}
                      />
                    </label>
                  ),
                )}
              </div>
              <div className="mt-3 flex items-center justify-end">
                <button
                  type="button"
                  className={toolbarPrimaryClasses}
                  onClick={() => void onSaveMetadata()}
                  disabled={savingMetadata || loading || !loaded}
                >
                  {savingMetadata ? "Saving..." : "Save metadata"}
                </button>
              </div>
            </div>

            <EditablePairsCard
              title="Custom metadata"
              addLabel="Add metadata"
              emptyLabel="No custom metadata defined."
              entries={metadataItems}
              keyPlaceholder="x-custom-key"
              valuePlaceholder="value"
              onAdd={onAddMetadata}
              onChange={onMetadataItemChange}
              onRemove={onRemoveMetadata}
            />
          </div>

          <div className="space-y-4">
            <EditablePairsCard
              title="Tags"
              addLabel="Add tag"
              emptyLabel="No tags defined."
              entries={tags}
              keyPlaceholder="Key"
              valuePlaceholder="Value"
              onAdd={onAddTag}
              onChange={onTagChange}
              onRemove={onRemoveTag}
              footer={
                <div className="mt-3 flex items-center justify-end">
                  <button
                    type="button"
                    className={toolbarPrimaryClasses}
                    onClick={() => void onSaveTags()}
                    disabled={savingTags || loading}
                  >
                    {savingTags ? "Saving..." : "Save tags"}
                  </button>
                </div>
              }
            />

            <div className={browserPanelCardClasses}>
              <p className="ui-caption font-semibold uppercase tracking-wide text-slate-400">
                Storage class
              </p>
              <label className="mt-2 block space-y-1 ui-caption font-semibold text-slate-600 dark:text-slate-300">
                <span>Storage class</span>
                <select
                  className={formInputClasses}
                  value={storageClass}
                  onChange={(event) =>
                    onStorageClassChange(event.target.value)
                  }
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
                Changing storage class triggers a copy of the object with the
                new storage tier.
              </p>
              <div className="mt-3 flex items-center justify-end">
                <button
                  type="button"
                  className={toolbarPrimaryClasses}
                  onClick={() => void onSaveStorageClass()}
                  disabled={savingStorageClass || !storageClass}
                >
                  {savingStorageClass ? "Saving..." : "Save storage class"}
                </button>
              </div>
            </div>
          </div>
        </div>
      </fieldset>
    </>
  );
}
