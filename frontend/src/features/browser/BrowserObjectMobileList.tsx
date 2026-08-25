import type { MouseEvent as ReactMouseEvent } from "react";

import { uiCheckboxClass } from "../../components/ui/styles";
import { FileIcon, FolderIcon, MoreIcon, TrashIcon, UpIcon } from "./browserIcons";
import {
  isBrowserInteractiveTarget,
  resolveBrowserItemOpenLabel,
} from "./browserObjectItemPresentation";
import type { BrowserItem } from "./browserTypes";

type BrowserObjectMobileListProps = {
  items: readonly BrowserItem[];
  selectedIds: ReadonlySet<string>;
  loading: boolean;
  hasBucket: boolean;
  showParentFolder: boolean;
  hasActiveSearchFilters: boolean;
  issueTitle?: string;
  workspaceNoun: string;
  workspaceObjectNounPlural: string;
  rowActionButtonClasses: string;
  onGoUp: () => void;
  onSelectItem: (
    event: ReactMouseEvent<HTMLDivElement>,
    item: BrowserItem,
  ) => void;
  onItemDoubleClick: (
    event: ReactMouseEvent<HTMLDivElement>,
    item: BrowserItem,
  ) => void;
  onItemContextMenu: (
    event: ReactMouseEvent<HTMLDivElement>,
    item: BrowserItem,
  ) => void;
  onToggleSelection: (item: BrowserItem) => void;
  onItemNameClick: (
    event: ReactMouseEvent<HTMLButtonElement>,
    item: BrowserItem,
  ) => void;
  onOpenActions: (
    event: ReactMouseEvent<HTMLButtonElement>,
    item: BrowserItem,
  ) => void;
};

export default function BrowserObjectMobileList({
  items,
  selectedIds,
  loading,
  hasBucket,
  showParentFolder,
  hasActiveSearchFilters,
  issueTitle,
  workspaceNoun,
  workspaceObjectNounPlural,
  rowActionButtonClasses,
  onGoUp,
  onSelectItem,
  onItemDoubleClick,
  onItemContextMenu,
  onToggleSelection,
  onItemNameClick,
  onOpenActions,
}: BrowserObjectMobileListProps) {
  return (
    <div
      role="list"
      aria-label="Objects"
      className="divide-y divide-slate-200/80 dark:divide-slate-800"
    >
      {showParentFolder && (
        <button
          type="button"
          onClick={onGoUp}
          className="flex min-h-11 w-full items-center gap-3 px-3 py-2 text-left font-semibold text-slate-700 dark:text-slate-200"
        >
          <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900">
            <UpIcon className="h-4 w-4" />
          </span>
          Parent folder
        </button>
      )}
      {!loading && !hasBucket && (
        <p className="px-4 py-10 text-center ui-body text-slate-500">
          {`Select a ${workspaceNoun} to browse ${workspaceObjectNounPlural}.`}
        </p>
      )}
      {!loading && hasBucket && items.length === 0 && (
        <p className="px-4 py-10 text-center ui-body text-slate-500">
          {issueTitle ??
            (hasActiveSearchFilters
              ? "No objects matched this search."
              : "No objects found for this path.")}
        </p>
      )}
      {items.map((item) => {
        const isSelected = selectedIds.has(item.id);
        const isDeleted = Boolean(item.isDeleted);
        const isHistorical = Boolean(item.isHistorical);
        return (
          <div
            key={item.id}
            role="listitem"
            data-browser-item
            data-lazy-item-id={
              item.type === "file" && !isDeleted ? item.id : undefined
            }
            onClick={(event) => {
              if (isBrowserInteractiveTarget(event.target) || isDeleted) return;
              onSelectItem(event, item);
            }}
            onDoubleClick={(event) => onItemDoubleClick(event, item)}
            onContextMenu={(event) => onItemContextMenu(event, item)}
            className={`grid min-h-16 grid-cols-[44px_minmax(0,1fr)_44px] items-center gap-1 px-2 py-2 focus-within:outline focus-within:outline-2 focus-within:outline-offset-[-2px] focus-within:outline-primary ${
              isSelected
                ? "bg-primary-100/90 dark:bg-primary-500/30"
                : "hover:bg-slate-50/80 dark:hover:bg-slate-800/40"
            }`}
          >
            <label className="flex h-11 w-11 items-center justify-center">
              <input
                type="checkbox"
                checked={!isDeleted && isSelected}
                onChange={() => onToggleSelection(item)}
                aria-label={`Select ${item.name}`}
                className={uiCheckboxClass}
                disabled={isDeleted}
              />
            </label>
            <button
              type="button"
              onClick={(event) => onItemNameClick(event, item)}
              onDoubleClick={(event) => event.preventDefault()}
              aria-label={resolveBrowserItemOpenLabel(item)}
              className="flex min-h-11 min-w-0 items-center gap-3 text-left"
            >
              <span
                className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md border ${
                  isDeleted
                    ? "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-500/40 dark:bg-rose-900/20 dark:text-rose-200"
                    : item.type === "folder"
                      ? "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/40 dark:bg-amber-900/20 dark:text-amber-200"
                      : "border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-500/40 dark:bg-sky-900/20 dark:text-sky-200"
                }`}
              >
                {item.type === "folder" ? (
                  <FolderIcon />
                ) : isDeleted ? (
                  <TrashIcon />
                ) : (
                  <FileIcon />
                )}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-semibold text-slate-900 dark:text-slate-100">
                  {item.name}
                </span>
                <span className="mt-0.5 flex min-w-0 items-center gap-2 ui-caption text-slate-500 dark:text-slate-400">
                  <span className="truncate">
                    {item.type === "folder" ? "Folder" : item.size}
                  </span>
                  <span aria-hidden="true">·</span>
                  <span className="truncate">{item.modified}</span>
                  {(isDeleted || isHistorical) && (
                    <span
                      className={`shrink-0 rounded-full border px-1.5 py-0.5 font-semibold ${
                        isDeleted
                          ? "border-rose-200 text-rose-700 dark:border-rose-500/40 dark:text-rose-200"
                          : "border-amber-200 text-amber-700 dark:border-amber-500/40 dark:text-amber-200"
                      }`}
                    >
                      {isDeleted ? "Deleted" : "History"}
                    </span>
                  )}
                </span>
              </span>
            </button>
            <button
              type="button"
              className={`${rowActionButtonClasses} min-h-11 min-w-11`}
              aria-label={`More actions for ${item.name}`}
              onClick={(event) => onOpenActions(event, item)}
            >
              <MoreIcon />
            </button>
          </div>
        );
      })}
    </div>
  );
}
