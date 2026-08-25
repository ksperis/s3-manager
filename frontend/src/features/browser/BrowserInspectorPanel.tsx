import type { ComponentProps } from "react";

import { cx, uiCardMutedClass } from "../../components/ui/styles";
import { formatBytes } from "../../utils/format";
import {
  BUCKET_INSPECTOR_FEATURE_CHIP_CLASSES,
  type BucketInspectorData,
  type BucketInspectorFeatureView,
} from "./browserBucketInspectorModel";
import { storageClassChipClasses } from "./browserConstants";
import { RefreshIcon } from "./browserIcons";
import { resolveBrowserInspectorItemTypeLabel } from "./browserObjectItemPresentation";
import type { BrowserPathStats } from "./browserObjectTableModel";
import BrowserObjectVersionsList from "./BrowserObjectVersionsList";
import type { BrowserItem } from "./browserTypes";
import {
  formatDateTime,
  isImageFile,
  previewLabelForItem,
} from "./browserUtils";

export type BrowserInspectorTab =
  | "context"
  | "bucket"
  | "selection"
  | "details";

type ContextCounts = {
  objects: number;
  versions: number;
  deleteMarkers: number;
};

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
  actionButtonClasses: string;
  context: {
    currentPath: string;
    pathStats: BrowserPathStats;
    versioningEnabled: boolean;
    showDeletedObjects: boolean;
    counts: ContextCounts | null;
    countsLoading: boolean;
    countsError: string | null;
    canCount: boolean;
    onCount: () => void;
  };
  bucket: {
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
  selection: {
    hasActions: boolean;
    selectedCount: number;
    isSingle: boolean;
    primary: BrowserItem | null;
    fileCount: number;
    folderCount: number;
    hasDeleted: boolean;
    selectedBytes: number;
    onOpenFullDetails: () => void;
  };
  details: {
    item: BrowserItem | null;
    path: string;
    versioningEnabled: boolean;
    versions: VersionsProps;
    onOpenFullDetails: () => void;
  };
  onSelectTab: (tab: Exclude<BrowserInspectorTab, "bucket">) => void;
  onOpenBucketTab: () => void;
};

const tabListClasses =
  "flex flex-nowrap gap-1 rounded-lg border border-[color:var(--ui-border)] bg-[var(--ui-surface-muted)] p-1 shadow-[var(--ui-shadow-soft)]";
const tabBaseClasses =
  "inline-flex min-w-0 flex-1 items-center justify-center rounded-md border px-2.5 py-1.5 text-center ui-caption font-semibold whitespace-nowrap transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary";
const tabInactiveClasses =
  "border-transparent bg-transparent text-slate-600 hover:border-slate-200 hover:bg-white hover:text-slate-900 dark:text-slate-300 dark:hover:border-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-100";
const tabActiveClasses =
  "border-slate-200 bg-white text-slate-900 shadow-sm dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100";
const tabPanelClasses =
  "space-y-4 ui-caption text-slate-600 dark:text-slate-300";
const sectionCardClasses = cx(uiCardMutedClass, "px-3.5 py-3 shadow-none");
const sectionTitleClasses =
  "ui-caption font-semibold text-slate-500 dark:text-slate-400";
const emptyStateClasses =
  "rounded-lg border border-dashed border-[color:var(--ui-border)] bg-[var(--ui-surface-muted)] px-3 py-4 ui-caption text-[var(--ui-text-muted)]";

function tabClasses(active: boolean): string {
  return `${tabBaseClasses} ${
    active ? tabActiveClasses : tabInactiveClasses
  }`;
}

export default function BrowserInspectorPanel({
  activeTab,
  workspaceNoun,
  workspaceNounCapitalized,
  usePortalWorkspaceLabels,
  actionButtonClasses,
  context,
  bucket,
  selection,
  details,
  onSelectTab,
  onOpenBucketTab,
}: BrowserInspectorPanelProps) {
  return (
    <div className="flex min-h-0 h-full flex-col gap-3">
      <div className="ui-surface-card flex min-h-0 h-full flex-1 flex-col px-3 py-3">
        <div className={tabListClasses} role="tablist" aria-label="Inspector tabs">
          <button
            type="button"
            role="tab"
            id="inspector-tab-details"
            aria-selected={activeTab === "details"}
            aria-controls="inspector-panel-details"
            onClick={() => onSelectTab("details")}
            className={tabClasses(activeTab === "details")}
          >
            Details
          </button>
          <button
            type="button"
            role="tab"
            id="inspector-tab-context"
            aria-selected={activeTab === "context"}
            aria-controls="inspector-panel-context"
            onClick={() => onSelectTab("context")}
            className={tabClasses(activeTab === "context")}
          >
            Context
          </button>
          <button
            type="button"
            role="tab"
            id="inspector-tab-bucket"
            aria-selected={activeTab === "bucket"}
            aria-controls="inspector-panel-bucket"
            onClick={onOpenBucketTab}
            className={tabClasses(activeTab === "bucket")}
          >
            {workspaceNounCapitalized}
          </button>
          <button
            type="button"
            role="tab"
            id="inspector-tab-selection"
            aria-selected={activeTab === "selection"}
            aria-controls="inspector-panel-selection"
            onClick={() => onSelectTab("selection")}
            className={tabClasses(activeTab === "selection")}
          >
            Selection
          </button>
        </div>

        <div className="mt-4 min-h-0 flex-1 overflow-y-auto pr-2">
          {activeTab === "context" && (
            <div
              role="tabpanel"
              id="inspector-panel-context"
              aria-labelledby="inspector-tab-context"
              className={tabPanelClasses}
            >
              <div className={sectionCardClasses}>
                <p className={sectionTitleClasses}>Current location</p>
                <p className="break-all ui-caption text-slate-500 dark:text-slate-400">
                  {context.currentPath ||
                    `Select a ${workspaceNoun} to get started.`}
                </p>
              </div>
              <div className="space-y-3">
                <div className={sectionCardClasses}>
                  <p className={sectionTitleClasses}>Prefix summary</p>
                  <div className="mt-2 grid gap-2">
                    <div className="flex items-center justify-between">
                      <span className="text-slate-500">Files</span>
                      <span className="font-semibold text-slate-700 dark:text-slate-100">
                        {context.pathStats.files}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-slate-500">Folders</span>
                      <span className="font-semibold text-slate-700 dark:text-slate-100">
                        {context.pathStats.folders}
                      </span>
                    </div>
                    {context.versioningEnabled && context.showDeletedObjects && (
                      <div className="flex items-center justify-between">
                        <span className="text-slate-500">Deleted shown</span>
                        <span className="font-semibold text-rose-700 dark:text-rose-200">
                          {context.pathStats.deletedFiles +
                            context.pathStats.deletedFolders}
                        </span>
                      </div>
                    )}
                    <div className="flex items-center justify-between">
                      <span className="text-slate-500">Total size</span>
                      <span className="font-semibold text-slate-700 dark:text-slate-100">
                        {formatBytes(context.pathStats.totalBytes)}
                      </span>
                    </div>
                  </div>
                </div>
                <div className={sectionCardClasses}>
                  <div className="flex items-center justify-between gap-2">
                    <p className={sectionTitleClasses}>Counts</p>
                    <button
                      type="button"
                      className={actionButtonClasses}
                      onClick={context.onCount}
                      disabled={!context.canCount || context.countsLoading}
                    >
                      <RefreshIcon className="h-3.5 w-3.5" />
                      {context.countsLoading
                        ? "Counting..."
                        : context.counts
                          ? "Recount"
                          : "Count"}
                    </button>
                  </div>
                  {context.countsError && (
                    <p className="mt-2 ui-caption font-semibold text-rose-600 dark:text-rose-200">
                      {context.countsError}
                    </p>
                  )}
                  {!context.versioningEnabled && (
                    <p className="mt-2 ui-caption text-slate-500 dark:text-slate-400">
                      {usePortalWorkspaceLabels
                        ? "File history is not available in this view."
                        : "Versioning is disabled for this bucket."}
                    </p>
                  )}
                  <div className="mt-2 grid gap-2">
                    <div className="flex items-center justify-between">
                      <span className="text-slate-500">Current objects</span>
                      <span className="font-semibold text-slate-700 dark:text-slate-100">
                        {context.countsLoading
                          ? "..."
                          : context.counts
                            ? context.counts.objects
                            : "-"}
                      </span>
                    </div>
                    {context.versioningEnabled && (
                      <>
                        <div className="flex items-center justify-between">
                          <span className="text-slate-500">Versions</span>
                          <span className="font-semibold text-slate-700 dark:text-slate-100">
                            {context.countsLoading
                              ? "..."
                              : context.counts
                                ? context.counts.versions
                                : "-"}
                          </span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-slate-500">Delete markers</span>
                          <span className="font-semibold text-slate-700 dark:text-slate-100">
                            {context.countsLoading
                              ? "..."
                              : context.counts
                                ? context.counts.deleteMarkers
                                : "-"}
                          </span>
                        </div>
                      </>
                    )}
                  </div>
                </div>
                <div className={sectionCardClasses}>
                  <p className={sectionTitleClasses}>Storage classes</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {Object.keys(context.pathStats.storageCounts).length === 0 ? (
                      <span className="ui-caption text-slate-500 dark:text-slate-400">
                        No file data yet.
                      </span>
                    ) : (
                      Object.entries(context.pathStats.storageCounts).map(
                        ([storage, count]) => (
                          <span
                            key={storage}
                            className={`rounded-full border px-2 py-1 ui-caption font-semibold ${
                              storageClassChipClasses[storage] ??
                              "border-slate-200 text-slate-600 dark:border-slate-700 dark:text-slate-300"
                            }`}
                          >
                            {storage} ({count})
                          </span>
                        ),
                      )
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeTab === "bucket" && (
            <div
              role="tabpanel"
              id="inspector-panel-bucket"
              aria-labelledby="inspector-tab-bucket"
              className={tabPanelClasses}
            >
              <div className="space-y-3">
                <div className={sectionCardClasses}>
                  <p className={sectionTitleClasses}>
                    {`${workspaceNounCapitalized} overview`}
                  </p>
                  <p className="mt-1 ui-caption text-slate-500 dark:text-slate-400">
                    {bucket.name ||
                      `Select a ${workspaceNoun} to inspect.`}
                  </p>
                </div>

                {!bucket.name || !bucket.hasContext ? (
                  <div className={emptyStateClasses}>
                    {`Select a ${workspaceNoun} to load ${workspaceNoun} stats and features.`}
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
                      <p className={sectionTitleClasses}>Stats</p>
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
                            {usePortalWorkspaceLabels
                              ? "File count"
                              : "Object count"}
                          </span>
                          <span className="font-semibold text-slate-700 dark:text-slate-100">
                            {bucket.data?.object_count != null
                              ? bucket.data.object_count.toLocaleString()
                              : "-"}
                          </span>
                        </div>
                      </div>
                    </div>

                    {bucket.isCephContext && (
                      <div className={sectionCardClasses}>
                        <p className={sectionTitleClasses}>Ceph</p>
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
                            <span className="text-slate-500">
                              Bucket quota size
                            </span>
                            <span className="font-semibold text-slate-700 dark:text-slate-100">
                              {(bucket.data?.quota_max_size_bytes ?? 0) > 0
                                ? formatBytes(
                                    bucket.data?.quota_max_size_bytes ?? null,
                                  )
                                : "Not set"}
                            </span>
                          </div>
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-slate-500">
                              Bucket quota objects
                            </span>
                            <span className="font-semibold text-slate-700 dark:text-slate-100">
                              {(bucket.data?.quota_max_objects ?? 0) > 0
                                ? (
                                    bucket.data?.quota_max_objects ?? 0
                                  ).toLocaleString()
                                : "Not set"}
                            </span>
                          </div>
                        </div>
                      </div>
                    )}

                    <div className={sectionCardClasses}>
                      <p className={sectionTitleClasses}>Features</p>
                      <p className="mt-1 ui-caption text-slate-500 dark:text-slate-400">
                        {usePortalWorkspaceLabels
                          ? "Only user-facing storage details are shown in this Portal view."
                          : "States mirror the Manager bucket overview when available."}
                      </p>
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
                              <span className="text-slate-500">
                                {feature.label}
                              </span>
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
                  </div>
                )}
              </div>
            </div>
          )}

          {activeTab === "selection" && (
            <div
              role="tabpanel"
              id="inspector-panel-selection"
              aria-labelledby="inspector-tab-selection"
              className={tabPanelClasses}
            >
              {selection.hasActions ? (
                <div className="space-y-3">
                  <div
                    className={`${sectionCardClasses} flex items-start justify-between gap-2`}
                  >
                    <div>
                      <p className={sectionTitleClasses}>Selection</p>
                      <p className="mt-1 ui-caption text-slate-400">
                        {selection.selectedCount > 0
                          ? `${selection.selectedCount} selected`
                          : "No selection"}
                      </p>
                      {selection.selectedCount > 0 && (
                        <p className="ui-caption text-slate-400">
                          {selection.isSingle && selection.primary
                            ? selection.primary.name
                            : `${selection.fileCount} files · ${selection.folderCount} folders`}
                        </p>
                      )}
                      {selection.hasDeleted && (
                        <p className="ui-caption font-semibold text-amber-600 dark:text-amber-200">
                          Contains deleted items (derived from delete markers).
                        </p>
                      )}
                      {selection.selectedCount > 0 && (
                        <p className="ui-caption text-slate-400">
                          Total size: {formatBytes(selection.selectedBytes)}
                        </p>
                      )}
                    </div>
                  </div>
                  {selection.isSingle && selection.primary?.type === "file" && (
                    <button
                      type="button"
                      className={actionButtonClasses}
                      onClick={selection.onOpenFullDetails}
                    >
                      Open full details
                    </button>
                  )}
                </div>
              ) : (
                <div className={emptyStateClasses}>
                  Select one or more objects to see selection actions.
                </div>
              )}
            </div>
          )}

          {activeTab === "details" && (
            <div
              role="tabpanel"
              id="inspector-panel-details"
              aria-labelledby="inspector-tab-details"
              className={tabPanelClasses}
            >
              {details.item ? (
                <div className="space-y-3">
                  <div className={sectionCardClasses}>
                    <p className={sectionTitleClasses}>Object details</p>
                  </div>
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
                      <div>
                        <p className="ui-body font-semibold text-slate-900 dark:text-slate-100">
                          {details.item.name}
                        </p>
                        <p className="ui-caption text-slate-500 dark:text-slate-400">
                          {resolveBrowserInspectorItemTypeLabel(details.item)} |{" "}
                          {details.item.size}
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
                    <div className="grid gap-2 ui-caption text-slate-600 dark:text-slate-300">
                      <div className="grid grid-cols-[minmax(0,6.5rem)_minmax(0,1fr)] items-start gap-x-3 gap-y-1">
                        <span className="text-slate-500">Path</span>
                        <span className="min-w-0 break-all text-right font-semibold text-slate-700 dark:text-slate-100">
                          {details.path}
                        </span>
                      </div>
                      <div className="grid grid-cols-[minmax(0,6.5rem)_minmax(0,1fr)] items-start gap-x-3 gap-y-1">
                        <span className="text-slate-500">Owner</span>
                        <span className="min-w-0 break-words text-right font-semibold text-slate-700 dark:text-slate-100">
                          {details.item.owner}
                        </span>
                      </div>
                      <div className="grid grid-cols-[minmax(0,6.5rem)_minmax(0,1fr)] items-start gap-x-3 gap-y-1">
                        <span className="text-slate-500">Last modified</span>
                        <span className="min-w-0 text-right font-semibold text-slate-700 dark:text-slate-100">
                          {details.item.modified}
                        </span>
                      </div>
                      <div className="grid grid-cols-[minmax(0,6.5rem)_minmax(0,1fr)] items-start gap-x-3 gap-y-1">
                        <span className="text-slate-500">Type</span>
                        <span className="min-w-0 break-words text-right font-semibold text-slate-700 dark:text-slate-100">
                          {resolveBrowserInspectorItemTypeLabel(details.item)}
                        </span>
                      </div>
                      <div className="grid grid-cols-[minmax(0,6.5rem)_minmax(0,1fr)] items-start gap-x-3 gap-y-1">
                        <span className="text-slate-500">Storage class</span>
                        <span className="min-w-0 break-words text-right font-semibold text-slate-700 dark:text-slate-100">
                          {details.item.storageClass ?? "-"}
                        </span>
                      </div>
                    </div>
                  </div>
                  {details.versioningEnabled && details.item.type === "file" && (
                    <BrowserObjectVersionsList
                      title="Versions"
                      containerClassName={sectionCardClasses}
                      titleClassName={sectionTitleClasses}
                      bodyClassName="mt-2 space-y-2"
                      {...details.versions}
                    />
                  )}
                </div>
              ) : (
                <div className={emptyStateClasses}>
                  Select a single object to view details.
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
