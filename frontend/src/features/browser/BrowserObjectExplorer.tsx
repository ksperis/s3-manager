import type {
  ComponentProps,
  DragEventHandler,
  KeyboardEventHandler,
  MouseEvent as ReactMouseEvent,
  MouseEventHandler,
  ReactNode,
} from "react";

import TableEmptyState from "../../components/TableEmptyState";
import { cx, uiCardClass, uiMutedTextClass } from "../../components/ui/styles";
import BrowserObjectMobileList from "./BrowserObjectMobileList";
import {
  BrowserObjectTableScaffold,
  BrowserParentFolderRow,
} from "./BrowserObjectTableScaffold";
import BrowserObjectTableRow from "./BrowserObjectTableRow";
import {
  DIRECT_DELETED_ITEM_ACTION_IDS,
  DIRECT_ITEM_ACTION_IDS,
  DIRECT_PORTAL_ITEM_ACTION_IDS,
  type LazyColumnCacheEntry,
} from "./browserObjectTableModel";
import {
  getVisibleBrowserActions,
  type BrowserActionId,
  type BrowserActionMap,
} from "./browserActions";
import { isBrowserInteractiveTarget } from "./browserObjectItemPresentation";
import type { BrowserItem } from "./browserTypes";

type BrowserObjectTableConfig = {
  scaffold: Omit<
    ComponentProps<typeof BrowserObjectTableScaffold>,
    "children"
  >;
  row: Pick<
    ComponentProps<typeof BrowserObjectTableRow>,
    | "compactMode"
    | "rowHeightClasses"
    | "rowCellClasses"
    | "iconBoxClasses"
    | "nameGapClasses"
    | "primaryItemButtonHeightClasses"
    | "rowActionButtonClasses"
  >;
};

type BrowserObjectExplorerProps = {
  viewportRef: ComponentProps<"div">["ref"];
  dragging: boolean;
  mobile: boolean;
  bucketName: string;
  normalizedPrefix: string;
  workspaceNoun: string;
  workspaceObjectNounPlural: string;
  items: readonly BrowserItem[];
  selectedIds: ReadonlySet<string>;
  loading: boolean;
  loadingMore: boolean;
  canLoadMore: boolean;
  objectsIsTruncated: boolean;
  deletedObjectsIsTruncated: boolean;
  showDeletedObjects: boolean;
  showParentFolder: boolean;
  hasActiveSearchFilters: boolean;
  searchStatusChips: readonly { label: string; value: string }[];
  issue: { title: string; description: ReactNode } | null;
  lazyColumnCache: Readonly<Record<string, LazyColumnCacheEntry>>;
  isPortalProfile: boolean;
  table: BrowserObjectTableConfig;
  loadMoreButtonClasses: string;
  resolveItemActions: (item: BrowserItem) => BrowserActionMap;
  onDragEnter: DragEventHandler<HTMLDivElement>;
  onDragOver: DragEventHandler<HTMLDivElement>;
  onDragLeave: DragEventHandler<HTMLDivElement>;
  onDrop: DragEventHandler<HTMLDivElement>;
  onPathContextMenu: MouseEventHandler<HTMLDivElement>;
  onListBackgroundClick: MouseEventHandler<HTMLDivElement>;
  onListKeyDown: KeyboardEventHandler<HTMLDivElement>;
  onGoUp: () => void;
  onItemContextMenu: (
    event: ReactMouseEvent<HTMLElement>,
    item: BrowserItem,
  ) => void;
  onToggleSelection: (item: BrowserItem, extendRange: boolean) => void;
  onItemNameClick: (
    event: ReactMouseEvent<HTMLElement>,
    item: BrowserItem,
  ) => void;
  onRunItemAction: (item: BrowserItem, actionId: BrowserActionId) => void;
  onOpenActions: (
    event: ReactMouseEvent<HTMLButtonElement>,
    item: BrowserItem,
  ) => void;
  onLoadMore: () => void;
};

const explorerShellClasses = cx(
  uiCardClass,
  "relative flex min-h-0 flex-1 flex-col overflow-hidden",
);
const searchLabelClasses = cx("ui-caption font-medium", uiMutedTextClass);
const searchStatusChipClasses =
  "inline-flex max-w-full items-center gap-1 rounded-md border border-[color:var(--ui-border)] bg-[var(--ui-surface-muted)] px-2 py-1 ui-caption text-[var(--ui-text-muted)] shadow-[var(--ui-shadow-soft)]";

export default function BrowserObjectExplorer({
  viewportRef,
  dragging,
  mobile,
  bucketName,
  normalizedPrefix,
  workspaceNoun,
  workspaceObjectNounPlural,
  items,
  selectedIds,
  loading,
  loadingMore,
  canLoadMore,
  objectsIsTruncated,
  deletedObjectsIsTruncated,
  showDeletedObjects,
  showParentFolder,
  hasActiveSearchFilters,
  searchStatusChips,
  issue,
  lazyColumnCache,
  isPortalProfile,
  table,
  loadMoreButtonClasses,
  resolveItemActions,
  onDragEnter,
  onDragOver,
  onDragLeave,
  onDrop,
  onPathContextMenu,
  onListBackgroundClick,
  onListKeyDown,
  onGoUp,
  onItemContextMenu,
  onToggleSelection,
  onItemNameClick,
  onRunItemAction,
  onOpenActions,
  onLoadMore,
}: BrowserObjectExplorerProps) {
  const objectTableColSpan = 3 + table.scaffold.columns.length;
  return (
    <div
      className={`${explorerShellClasses} ${
        dragging
          ? "border-primary/60 bg-primary/5 dark:border-primary-500/60 dark:bg-primary-500/10"
          : ""
      }`}
      onDragEnter={onDragEnter}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      onContextMenu={onPathContextMenu}
    >
      {dragging && (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-xl bg-white/75 text-center ui-body font-semibold text-slate-700 backdrop-blur-sm dark:bg-slate-950/70 dark:text-slate-100">
          <div className="rounded-xl border border-primary/20 bg-white/90 px-5 py-4 shadow-sm dark:border-primary-500/30 dark:bg-slate-900/85">
            <div>Drop files or folders to upload</div>
            <div className="mt-1 ui-caption font-normal text-slate-500 dark:text-slate-400">
              {bucketName
                ? `${bucketName}/${normalizedPrefix}`
                : `Select a ${workspaceNoun} first`}
            </div>
          </div>
        </div>
      )}
      {bucketName && hasActiveSearchFilters && (
        <div className="shrink-0 border-b border-slate-200 bg-slate-50/80 px-3 py-2 dark:border-slate-700 dark:bg-slate-900/40">
          <div className="flex flex-col gap-2 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0">
              <p className={searchLabelClasses}>Search</p>
              <p className="mt-1 ui-body font-semibold text-slate-900 dark:text-slate-100">
                {loading
                  ? "Searching..."
                  : `${items.length} result${items.length === 1 ? "" : "s"}`}
              </p>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {searchStatusChips.map((chip) => (
                <span
                  key={`${chip.label}:${chip.value}`}
                  className={searchStatusChipClasses}
                  title={`${chip.label}: ${chip.value}`}
                >
                  <span className="text-slate-400 dark:text-slate-500">
                    {chip.label}
                  </span>
                  <span className="truncate text-slate-700 dark:text-slate-100">
                    {chip.value}
                  </span>
                </span>
              ))}
            </div>
          </div>
        </div>
      )}
      <div
        ref={viewportRef}
        className={`relative min-h-0 flex-1 overflow-y-auto bg-white/50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary dark:bg-transparent ${
          mobile ? "overflow-x-hidden pb-24" : "overflow-x-auto"
        }`}
        onClick={onListBackgroundClick}
        onKeyDown={onListKeyDown}
        tabIndex={0}
        aria-label="Objects list"
      >
        {loading && items.length > 0 && (
          <div className="pointer-events-none absolute inset-0 z-10 flex items-start justify-center bg-white/45 pt-5 ui-caption font-semibold text-slate-600 backdrop-blur-[1px] dark:bg-slate-900/40 dark:text-slate-200">
            <span className="rounded-md border border-slate-200 bg-white/90 px-3 py-1.5 shadow-sm dark:border-slate-700 dark:bg-slate-900/80">
              Refreshing objects...
            </span>
          </div>
        )}
        {mobile ? (
          <BrowserObjectMobileList
            items={items}
            selectedIds={selectedIds}
            loading={loading}
            hasBucket={Boolean(bucketName)}
            showParentFolder={showParentFolder}
            hasActiveSearchFilters={hasActiveSearchFilters}
            issueTitle={issue?.title}
            workspaceNoun={workspaceNoun}
            workspaceObjectNounPlural={workspaceObjectNounPlural}
            rowActionButtonClasses={table.row.rowActionButtonClasses}
            onGoUp={onGoUp}
            onItemContextMenu={onItemContextMenu}
            onToggleSelection={onToggleSelection}
            onItemNameClick={onItemNameClick}
            onOpenActions={onOpenActions}
          />
        ) : (
          <BrowserObjectTableScaffold {...table.scaffold}>
            {showParentFolder && (
              <BrowserParentFolderRow
                columns={table.scaffold.columns}
                nameColumnWidthPx={table.scaffold.nameColumnWidthPx}
                rowHeightClasses={table.row.rowHeightClasses}
                rowCellClasses={table.row.rowCellClasses}
                iconBoxClasses={table.row.iconBoxClasses}
                onGoUp={onGoUp}
              />
            )}
            {loading && items.length === 0 && (
              <TableEmptyState
                colSpan={objectTableColSpan}
                message={`Loading ${workspaceObjectNounPlural}...`}
                className="py-10 text-center"
              />
            )}
            {!loading && !bucketName && (
              <TableEmptyState
                colSpan={objectTableColSpan}
                message={`Select a ${workspaceNoun} to browse ${workspaceObjectNounPlural}.`}
                className="py-10 text-center"
              />
            )}
            {!loading && bucketName && issue && items.length === 0 && (
              <TableEmptyState
                colSpan={objectTableColSpan}
                title={issue.title}
                description={issue.description}
                tone="error"
                className="py-10 text-center"
              />
            )}
            {!loading && bucketName && !issue && items.length === 0 && (
              <TableEmptyState
                colSpan={objectTableColSpan}
                message={
                  hasActiveSearchFilters
                    ? "No objects matched this search."
                    : showDeletedObjects && deletedObjectsIsTruncated
                      ? "No deleted files found yet. Continue loading to search more history."
                      : "No objects found for this path."
                }
                className="py-10 text-center"
              />
            )}
            {items.map((item) => {
              const isDeleted = Boolean(item.isDeleted);
              const directItemActions = getVisibleBrowserActions(
                resolveItemActions(item),
                isDeleted
                  ? DIRECT_DELETED_ITEM_ACTION_IDS
                  : isPortalProfile
                    ? DIRECT_PORTAL_ITEM_ACTION_IDS
                    : DIRECT_ITEM_ACTION_IDS,
              );
              return (
                <BrowserObjectTableRow
                  key={item.id}
                  item={item}
                  selected={selectedIds.has(item.id)}
                  compactMode={table.row.compactMode}
                  nameColumnWidthPx={table.scaffold.nameColumnWidthPx}
                  visibleColumns={table.scaffold.columns}
                  lazyEntry={lazyColumnCache[item.id]}
                  directActions={directItemActions}
                  rowHeightClasses={table.row.rowHeightClasses}
                  rowCellClasses={table.row.rowCellClasses}
                  iconBoxClasses={table.row.iconBoxClasses}
                  nameGapClasses={table.row.nameGapClasses}
                  primaryItemButtonHeightClasses={
                    table.row.primaryItemButtonHeightClasses
                  }
                  rowActionButtonClasses={table.row.rowActionButtonClasses}
                  onClick={(event) => {
                    if (
                      isBrowserInteractiveTarget(event.target) ||
                      event.detail > 1
                    )
                      return;
                    onItemNameClick(event, item);
                  }}
                  onContextMenu={(event) => onItemContextMenu(event, item)}
                  onToggleSelection={(extendRange) =>
                    onToggleSelection(item, extendRange)
                  }
                  onNameClick={(event) => onItemNameClick(event, item)}
                  onRunAction={(actionId) => onRunItemAction(item, actionId)}
                  onOpenActions={(event) => onOpenActions(event, item)}
                />
              );
            })}
          </BrowserObjectTableScaffold>
        )}
      </div>
      {canLoadMore && (
        <div className="border-t border-slate-200 bg-slate-50/70 px-4 py-3 text-right dark:border-slate-700 dark:bg-slate-900/40">
          <button
            type="button"
            className={loadMoreButtonClasses}
            onClick={onLoadMore}
            disabled={loadingMore}
          >
            {loadingMore
              ? "Loading..."
              : !objectsIsTruncated && deletedObjectsIsTruncated
                ? "Continue loading deleted files"
                : "Load more"}
          </button>
        </div>
      )}
    </div>
  );
}
