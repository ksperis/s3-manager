import type { ComponentProps } from "react";

import { cx, uiCardMutedClass } from "../../components/ui/styles";
import { formatBytes } from "../../utils/format";
import {
  BUCKET_INSPECTOR_FEATURE_CHIP_CLASSES,
  type BucketInspectorData,
  type BucketInspectorFeatureView,
} from "./browserBucketInspectorModel";
import { iconButtonClasses } from "./browserConstants";
import { XIcon } from "./browserIcons";
import { resolveBrowserInspectorItemTypeLabel } from "./browserObjectItemPresentation";
import BrowserObjectVersionsList from "./BrowserObjectVersionsList";
import type { BrowserItem } from "./browserTypes";
import {
  formatDateTime,
  isImageFile,
  previewLabelForItem,
} from "./browserUtils";

export type BrowserInspectorTab = "bucket" | "details";

type VersionsProps = Pick<
  ComponentProps<typeof BrowserObjectVersionsList>,
  | "versions"
  | "loading"
  | "error"
  | "canLoadMore"
  | "onLoadMore"
  | "onRestoreVersion"
  | "onDeleteVersion"
>;

type BrowserInspectorPanelProps = {
  activeTab: BrowserInspectorTab;
  workspaceNoun: string;
  workspaceNounCapitalized: string;
  usePortalWorkspaceLabels: boolean;
  technicalDetailsEnabled: boolean;
  actionButtonClasses: string;
  bucket: {
    available: boolean;
    name: string;
    hasContext: boolean;
    loading: boolean;
    error: string | null;
    data: BucketInspectorData | null;
    features: readonly BucketInspectorFeatureView[];
    isCephContext: boolean;
    cephQuotaScopeLabel: string;
    cephContextQuotaSizeBytes: number | null;
    cephContextQuotaObjects: number | null;
  };
  details: {
    item: BrowserItem | null;
    path: string;
    versioningEnabled: boolean;
    versions: VersionsProps;
    onOpenFullDetails: () => void;
  };
  onSelectDetails: () => void;
  onOpenBucket: () => void;
  onClose: () => void;
};

const viewButtonBaseClasses =
  "inline-flex min-w-0 flex-1 items-center justify-center rounded-md border px-2.5 py-1.5 text-center ui-caption font-semibold whitespace-nowrap transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:cursor-not-allowed disabled:opacity-50";
const viewButtonInactiveClasses =
  "border-transparent bg-transparent text-slate-600 hover:border-slate-200 hover:bg-white hover:text-slate-900 dark:text-slate-300 dark:hover:border-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-100";
const viewButtonActiveClasses =
  "border-slate-200 bg-white text-slate-900 shadow-sm dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100";
const sectionCardClasses = cx(uiCardMutedClass, "px-3.5 py-3 shadow-none");
const sectionTitleClasses =
  "ui-caption font-semibold text-slate-500 dark:text-slate-400";
const emptyStateClasses =
  "rounded-lg border border-dashed border-[color:var(--ui-border)] bg-[var(--ui-surface-muted)] px-3 py-4 ui-caption text-[var(--ui-text-muted)]";

function viewButtonClasses(active: boolean): string {
  return `${viewButtonBaseClasses} ${
    active ? viewButtonActiveClasses : viewButtonInactiveClasses
  }`;
}

export default function BrowserInspectorPanel({
  activeTab,
  workspaceNoun,
  workspaceNounCapitalized,
  usePortalWorkspaceLabels,
  technicalDetailsEnabled,
  actionButtonClasses,
  bucket,
  details,
  onSelectDetails,
  onOpenBucket,
  onClose,
}: BrowserInspectorPanelProps) {
  const objectSummaryRows: Array<[string, string]> = details.item
    ? [
        ["Path", details.path],
        ["Last modified", details.item.modified],
        ...(details.item.owner && details.item.owner !== "-"
          ? [["Owner", details.item.owner] as [string, string]]
          : []),
        ...(technicalDetailsEnabled && details.item.storageClass
          ? [["Storage class", details.item.storageClass] as [string, string]]
          : []),
        ...(technicalDetailsEnabled && details.item.etag
          ? [["ETag", details.item.etag] as [string, string]]
          : []),
      ]
    : [];

  return (
    <aside
      aria-label="Details panel"
      className="ui-surface-card flex h-full min-h-0 flex-col overflow-hidden p-3 shadow-lg"
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="ui-body font-semibold text-[var(--ui-text)]">Details</p>
          <p className="ui-caption text-[var(--ui-text-muted)]">
            Inspect the current object or {workspaceNoun}.
          </p>
        </div>
        <button
          type="button"
          className={iconButtonClasses}
          onClick={onClose}
          aria-label="Close details panel"
          title="Close details panel"
        >
          <XIcon className="h-3.5 w-3.5" />
        </button>
      </div>

      <div
        role="group"
        aria-label="Details view"
        className="mt-3 flex flex-nowrap gap-1 rounded-lg border border-[color:var(--ui-border)] bg-[var(--ui-surface-muted)] p-1"
      >
        <button
          type="button"
          aria-pressed={activeTab === "details"}
          className={viewButtonClasses(activeTab === "details")}
          onClick={onSelectDetails}
          disabled={!details.item}
        >
          Object
        </button>
        {bucket.available && (
          <button
            type="button"
            aria-pressed={activeTab === "bucket"}
            className={viewButtonClasses(activeTab === "bucket")}
            onClick={onOpenBucket}
          >
            {workspaceNounCapitalized}
          </button>
        )}
      </div>

      <div className="mt-4 min-h-0 flex-1 overflow-y-auto pr-1 ui-caption text-slate-600 dark:text-slate-300">
        {activeTab === "bucket" && bucket.available && (
          <div className="space-y-3">
            <div className={sectionCardClasses}>
              <p className={sectionTitleClasses}>
                {`${workspaceNounCapitalized} overview`}
              </p>
              <p className="mt-1 ui-caption text-slate-500 dark:text-slate-400">
                {bucket.name || `Select a ${workspaceNoun} to inspect.`}
              </p>
            </div>

            {!bucket.name || !bucket.hasContext ? (
              <div className={emptyStateClasses}>
                {`Select a ${workspaceNoun} to load its overview.`}
              </div>
            ) : (
              <div className="space-y-3">
                {bucket.loading && !bucket.data && (
                  <p className="ui-caption text-slate-500 dark:text-slate-400">
                    {`Loading ${workspaceNoun} overview...`}
                  </p>
                )}
                {bucket.error && (
                  <p className="ui-caption font-semibold text-rose-600 dark:text-rose-200">
                    {bucket.error}
                  </p>
                )}
                <div className={sectionCardClasses}>
                  <p className={sectionTitleClasses}>Summary</p>
                  <div className="mt-2 grid gap-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-slate-500">Created</span>
                      <span className="font-semibold text-slate-700 dark:text-slate-100">
                        {bucket.data?.creation_date
                          ? formatDateTime(bucket.data.creation_date)
                          : "-"}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-slate-500">Used bytes</span>
                      <span className="font-semibold text-slate-700 dark:text-slate-100">
                        {formatBytes(bucket.data?.used_bytes ?? null)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-slate-500">
                        {usePortalWorkspaceLabels ? "File count" : "Object count"}
                      </span>
                      <span className="font-semibold text-slate-700 dark:text-slate-100">
                        {bucket.data?.object_count != null
                          ? bucket.data.object_count.toLocaleString()
                          : "-"}
                      </span>
                    </div>
                  </div>
                </div>

                {technicalDetailsEnabled && bucket.isCephContext && (
                  <div className={sectionCardClasses}>
                    <p className={sectionTitleClasses}>Ceph quotas</p>
                    <div className="mt-2 grid gap-2">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-slate-500">
                          {bucket.cephQuotaScopeLabel} size
                        </span>
                        <span className="font-semibold text-slate-700 dark:text-slate-100">
                          {bucket.cephContextQuotaSizeBytes != null
                            ? formatBytes(bucket.cephContextQuotaSizeBytes)
                            : "Not set"}
                        </span>
                      </div>
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-slate-500">
                          {bucket.cephQuotaScopeLabel} objects
                        </span>
                        <span className="font-semibold text-slate-700 dark:text-slate-100">
                          {bucket.cephContextQuotaObjects != null
                            ? bucket.cephContextQuotaObjects.toLocaleString()
                            : "Not set"}
                        </span>
                      </div>
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-slate-500">Bucket quota size</span>
                        <span className="font-semibold text-slate-700 dark:text-slate-100">
                          {(bucket.data?.quota_max_size_bytes ?? 0) > 0
                            ? formatBytes(bucket.data?.quota_max_size_bytes ?? null)
                            : "Not set"}
                        </span>
                      </div>
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-slate-500">Bucket quota objects</span>
                        <span className="font-semibold text-slate-700 dark:text-slate-100">
                          {(bucket.data?.quota_max_objects ?? 0) > 0
                            ? (bucket.data?.quota_max_objects ?? 0).toLocaleString()
                            : "Not set"}
                        </span>
                      </div>
                    </div>
                  </div>
                )}

                {technicalDetailsEnabled && (
                  <div className={sectionCardClasses}>
                    <p className={sectionTitleClasses}>Features</p>
                    <div className="mt-2 space-y-2">
                      {bucket.features.length === 0 ? (
                        <p className="ui-caption text-slate-500 dark:text-slate-400">
                          No feature data available for this context.
                        </p>
                      ) : (
                        bucket.features.map((feature) => (
                          <div
                            key={feature.key}
                            className="flex items-center justify-between gap-2"
                          >
                            <span className="text-slate-500">{feature.label}</span>
                            <span
                              className={`rounded-full px-2 py-1 ui-caption font-semibold ${BUCKET_INSPECTOR_FEATURE_CHIP_CLASSES[feature.tone]}`}
                            >
                              {feature.state}
                            </span>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {activeTab === "details" && (
          <div className="space-y-3">
            {details.item ? (
              <>
                <div className="rounded-lg border border-[color:var(--ui-border-soft)] bg-[var(--ui-surface-muted)] px-3 py-2.5 shadow-[var(--ui-shadow-soft)]">
                  <div className="flex items-center gap-3">
                    <div
                      className={`flex h-10 w-10 items-center justify-center rounded-lg border ui-caption font-bold ${
                        isImageFile(details.item.name)
                          ? "border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-500/40 dark:bg-sky-900/30 dark:text-sky-200"
                          : "border-slate-200 bg-white text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                      }`}
                    >
                      {previewLabelForItem(details.item)}
                    </div>
                    <div className="min-w-0">
                      <p className="truncate ui-body font-semibold text-slate-900 dark:text-slate-100">
                        {details.item.name}
                      </p>
                      <p className="ui-caption text-slate-500 dark:text-slate-400">
                        {resolveBrowserInspectorItemTypeLabel(details.item)} | {details.item.size}
                      </p>
                    </div>
                  </div>
                </div>
                {details.item.type === "file" && (
                  <button
                    type="button"
                    className={actionButtonClasses}
                    onClick={details.onOpenFullDetails}
                  >
                    Open full details
                  </button>
                )}
                <div className={sectionCardClasses}>
                  <p className={sectionTitleClasses}>Summary</p>
                  <div className="mt-2 grid gap-2 ui-caption text-slate-600 dark:text-slate-300">
                    {objectSummaryRows.map(([label, value]) => {
                      const needsFullWidth = label === "Path" || label === "ETag";
                      return (
                        <div
                          key={label}
                          className={
                            needsFullWidth
                              ? "grid gap-1"
                              : "grid grid-cols-[minmax(0,6.5rem)_minmax(0,1fr)] items-start gap-x-3 gap-y-1"
                          }
                        >
                          <span className="text-slate-500">{label}</span>
                          <span
                            className={`min-w-0 font-semibold text-slate-700 dark:text-slate-100 ${
                              needsFullWidth
                                ? "break-all text-left"
                                : "break-words text-right"
                            }`}
                            title={value}
                          >
                            {value}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
                {technicalDetailsEnabled &&
                  details.versioningEnabled &&
                  details.item.type === "file" && (
                    <BrowserObjectVersionsList
                      title="Versions"
                      containerClassName={sectionCardClasses}
                      titleClassName={sectionTitleClasses}
                      bodyClassName="mt-2 space-y-2"
                      {...details.versions}
                    />
                  )}
              </>
            ) : (
              <div className={emptyStateClasses}>
                Select one object to inspect its details.
              </div>
            )}
          </div>
        )}
      </div>
    </aside>
  );
}
