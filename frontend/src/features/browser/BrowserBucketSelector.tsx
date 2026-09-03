import type { RefObject } from "react";

import type { BrowserBucket } from "../../api/browserContracts";
import { toolbarCompactInputClasses } from "../../components/toolbarControlClasses";
import { cx, uiMenuClass, uiMutedTextClass } from "../../components/ui/styles";
import {
  bucketButtonClasses,
  filterChipClasses,
} from "./browserConstants";
import { BucketIcon, ChevronDownIcon, SearchIcon } from "./browserIcons";

const menuClasses = cx(uiMenuClass, "overflow-hidden p-1.5");
const eyebrowClasses = cx("ui-caption font-semibold", uiMutedTextClass);
const inputClasses = cx(toolbarCompactInputClasses, "w-full py-2 font-medium");

type BrowserBucketSelectorProps = {
  rootRef: RefObject<HTMLDivElement>;
  filterInputRef: RefObject<HTMLInputElement>;
  lockedBucketName?: string | null;
  hasContext: boolean;
  open: boolean;
  buttonLabel: string;
  buttonActionLabel: string;
  needsAttention: boolean;
  workspaceNoun: string;
  workspaceNounPlural: string;
  workspaceNounTitle: string;
  bucketManagementEnabled: boolean;
  filter: string;
  loading: boolean;
  hasError: boolean;
  totalCount: number;
  total: number;
  items: BrowserBucket[];
  activeBucketName: string;
  displayNameByBucket: ReadonlyMap<string, string>;
  canLoadMore: boolean;
  loadingMore: boolean;
  onToggle: () => void;
  onCreateBucket: () => void;
  onFilterChange: (value: string) => void;
  onRetry: () => void;
  onSelectBucket: (bucketName: string) => void;
  onLoadMore: () => void;
};

export default function BrowserBucketSelector({
  rootRef,
  filterInputRef,
  lockedBucketName,
  hasContext,
  open,
  buttonLabel,
  buttonActionLabel,
  needsAttention,
  workspaceNoun,
  workspaceNounPlural,
  workspaceNounTitle,
  bucketManagementEnabled,
  filter,
  loading,
  hasError,
  totalCount,
  total,
  items,
  activeBucketName,
  displayNameByBucket,
  canLoadMore,
  loadingMore,
  onToggle,
  onCreateBucket,
  onFilterChange,
  onRetry,
  onSelectBucket,
  onLoadMore,
}: BrowserBucketSelectorProps) {
  const buttonClassName = cx(
    bucketButtonClasses,
    needsAttention
      ? "border-amber-300 bg-amber-50 text-amber-800 ring-2 ring-amber-200/70 dark:border-amber-400/60 dark:bg-amber-500/15 dark:text-amber-100 dark:ring-amber-400/30"
      : "border-slate-200 bg-white text-slate-700 hover:border-primary/60 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:hover:border-primary-500 dark:hover:bg-slate-800",
  );

  return (
    <div ref={rootRef} className="relative flex shrink-0 items-stretch">
      <button
        type="button"
        className={`${buttonClassName} min-h-9`}
        onClick={lockedBucketName ? undefined : onToggle}
        disabled={!hasContext}
        aria-haspopup={lockedBucketName ? undefined : "listbox"}
        aria-expanded={lockedBucketName ? undefined : open}
        aria-label={buttonActionLabel}
        title={buttonActionLabel}
      >
        <BucketIcon className="h-3.5 w-3.5 text-slate-500 dark:text-slate-300" />
        <span className="max-w-[200px] truncate sm:max-w-[260px]">
          {buttonLabel}
        </span>
        {!lockedBucketName && (
          <ChevronDownIcon className="h-3.5 w-3.5 text-slate-400" />
        )}
      </button>
      {open && !lockedBucketName && (
        <div
          className={`absolute left-0 top-[calc(100%+8px)] z-[60] w-80 max-w-[calc(100vw-1rem)] ui-caption ${menuClasses}`}
        >
          <div className="flex items-center justify-between gap-3 px-2 pb-2 pt-1">
            <p className={eyebrowClasses}>{workspaceNounTitle}</p>
            {bucketManagementEnabled && (
              <button
                type="button"
                onClick={onCreateBucket}
                disabled={!hasContext}
                className={filterChipClasses}
                title="Create bucket"
                aria-label="Create bucket"
              >
                + Bucket
              </button>
            )}
          </div>
          <div className="px-2 pb-2">
            <div className="relative">
              <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
              <input
                ref={filterInputRef}
                type="text"
                value={filter}
                onChange={(event) => onFilterChange(event.target.value)}
                placeholder={`Filter ${workspaceNounPlural}`}
                className={`${inputClasses} pl-9`}
                spellCheck={false}
              />
            </div>
          </div>
          <div className="max-h-56 overflow-y-auto px-1 pb-1">
            {loading && items.length === 0 ? (
              <div className="px-2 py-2 ui-caption text-slate-500 dark:text-slate-400">
                {`Loading ${workspaceNounPlural}...`}
              </div>
            ) : totalCount === 0 ? (
              <div className="space-y-2 px-2 py-2">
                <div className="ui-caption text-slate-500 dark:text-slate-400">
                  {hasError
                    ? `Unable to load ${workspaceNounPlural}.`
                    : `No ${workspaceNounPlural} available.`}
                </div>
                <button
                  type="button"
                  className={filterChipClasses}
                  onClick={onRetry}
                  disabled={loading || !hasContext}
                >
                  {loading ? "Retrying..." : "Retry"}
                </button>
              </div>
            ) : items.length === 0 ? (
              <div className="px-2 py-2 ui-caption text-slate-500 dark:text-slate-400">
                {`No ${workspaceNounPlural} match this filter.`}
              </div>
            ) : (
              items.map((bucket) => {
                const isActive = bucket.name === activeBucketName;
                const label = displayNameByBucket.get(bucket.name) ?? bucket.name;
                return (
                  <button
                    key={bucket.name}
                    type="button"
                    onClick={() => onSelectBucket(bucket.name)}
                    className={`flex w-full min-w-0 items-center justify-between rounded-md border px-3 py-2 text-left font-semibold transition ${
                      isActive
                        ? "border-primary-200 bg-primary-50 text-primary-800 shadow-sm dark:border-primary-500/40 dark:bg-primary-500/20 dark:text-primary-100"
                        : "border-transparent text-slate-700 hover:border-primary-200 hover:bg-slate-50 dark:text-slate-200 dark:hover:border-primary-500/40 dark:hover:bg-slate-800"
                    }`}
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <BucketIcon className="h-3.5 w-3.5 shrink-0" />
                      <span className="truncate">{label}</span>
                    </span>
                    {isActive && (
                      <span className="ui-caption font-semibold text-primary-600 dark:text-primary-200">
                        Active
                      </span>
                    )}
                  </button>
                );
              })
            )}
          </div>
          {!loading && totalCount > 0 && (
            <div className="border-t border-slate-200 px-2.5 py-2 ui-caption text-slate-400 dark:border-slate-700 dark:text-slate-500">
              {`${items.length} of ${total} ${workspaceNoun}${total === 1 ? "" : "s"}`}
            </div>
          )}
          {canLoadMore && (
            <div className="border-t border-slate-200 px-2.5 py-2 dark:border-slate-700">
              <button
                type="button"
                onClick={onLoadMore}
                disabled={loadingMore}
                className={filterChipClasses}
              >
                {loadingMore ? "Loading..." : "Load more"}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
