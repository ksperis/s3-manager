import type { MouseEvent as ReactMouseEvent } from "react";

import { uiCheckboxClass } from "../../components/ui/styles";
import { BrowserDirectItemActionButton } from "./BrowserActionPresentation";
import { storageClassChipClasses } from "./browserConstants";
import { FileIcon, FolderIcon, MoreIcon, TrashIcon } from "./browserIcons";
import { BrowserObjectColumnValue } from "./BrowserObjectTablePresentation";
import type { BrowserActionId, BrowserActionState } from "./browserActions";
import type {
  ColumnDefinition,
  LazyColumnCacheEntry,
} from "./browserObjectTableModel";
import type { BrowserItem } from "./browserTypes";

type BrowserObjectTableRowProps = {
  item: BrowserItem;
  selected: boolean;
  compactMode: boolean;
  nameColumnWidthPx: number;
  visibleColumns: readonly ColumnDefinition[];
  lazyEntry?: LazyColumnCacheEntry;
  directActions: readonly BrowserActionState[];
  rowHeightClasses: string;
  rowCellClasses: string;
  iconBoxClasses: string;
  nameGapClasses: string;
  primaryItemButtonHeightClasses: string;
  rowActionButtonClasses: string;
  onClick: (event: ReactMouseEvent<HTMLTableRowElement>) => void;
  onDoubleClick: (event: ReactMouseEvent<HTMLTableRowElement>) => void;
  onContextMenu: (event: ReactMouseEvent<HTMLTableRowElement>) => void;
  onToggleSelection: () => void;
  onNameClick: (event: ReactMouseEvent<HTMLButtonElement>) => void;
  onRunAction: (actionId: BrowserActionId) => void;
  onOpenActions: (event: ReactMouseEvent<HTMLButtonElement>) => void;
};

function resolveObjectTypeLabel(item: BrowserItem): string {
  if (item.type === "folder") {
    if (item.isHistorical) return "Historical folder";
    return item.isDeleted ? "Deleted folder" : "Prefix";
  }
  return item.isDeleted ? "Deleted object" : "Object";
}

function resolveOpenLabel(item: BrowserItem): string {
  if (item.isDeleted) return `Open versions for ${item.name}`;
  return item.type === "folder"
    ? `Open folder ${item.name}`
    : `Open file ${item.name}`;
}

export default function BrowserObjectTableRow({
  item,
  selected,
  compactMode,
  nameColumnWidthPx,
  visibleColumns,
  lazyEntry,
  directActions,
  rowHeightClasses,
  rowCellClasses,
  iconBoxClasses,
  nameGapClasses,
  primaryItemButtonHeightClasses,
  rowActionButtonClasses,
  onClick,
  onDoubleClick,
  onContextMenu,
  onToggleSelection,
  onNameClick,
  onRunAction,
  onOpenActions,
}: BrowserObjectTableRowProps) {
  const isDeleted = Boolean(item.isDeleted);
  const isHistorical = Boolean(item.isHistorical);
  return (
    <tr
      data-browser-item
      data-lazy-item-id={
        item.type === "file" && !item.isDeleted ? item.id : undefined
      }
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      onContextMenu={onContextMenu}
      className={`${rowHeightClasses} transition-colors focus-within:outline focus-within:outline-2 focus-within:outline-offset-[-2px] focus-within:outline-primary ${
        selected
          ? "bg-primary-100/90 shadow-[inset_0_1px_0_rgba(255,255,255,0.35)] hover:bg-primary-100 dark:bg-primary-500/30 dark:hover:bg-primary-500/40"
          : "hover:bg-slate-50/80 dark:hover:bg-slate-800/40"
      }`}
    >
      <td className={`px-2 ${rowCellClasses} !align-middle`}>
        <input
          type="checkbox"
          checked={!isDeleted && selected}
          onChange={onToggleSelection}
          aria-label={`Select ${item.name}`}
          className={uiCheckboxClass}
          disabled={isDeleted}
        />
      </td>
      <td
        className={`manager-table-cell min-w-0 px-4 ${rowCellClasses} !align-middle ui-body ${
          isHistorical
            ? "text-amber-800 dark:text-amber-200"
            : isDeleted
              ? "text-rose-700 dark:text-rose-200"
              : "text-slate-700 dark:text-slate-200"
        }`}
        style={{ maxWidth: `${nameColumnWidthPx}px` }}
      >
        <button
          type="button"
          onClick={onNameClick}
          onDoubleClick={(event) => event.preventDefault()}
          aria-label={resolveOpenLabel(item)}
          className={`flex ${primaryItemButtonHeightClasses} w-full min-w-0 items-center ${nameGapClasses} text-left`}
          title={item.name}
        >
          <span
            className={`inline-flex ${iconBoxClasses} items-center justify-center rounded-md border shadow-sm ${
              isHistorical
                ? "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/40 dark:bg-amber-900/20 dark:text-amber-200"
                : isDeleted
                  ? "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-500/40 dark:bg-rose-900/20 dark:text-rose-200"
                  : item.type === "folder"
                    ? "border-amber-200 bg-amber-50/90 text-amber-700 dark:border-amber-500/40 dark:bg-amber-900/20 dark:text-amber-200"
                    : "border-sky-200 bg-sky-50/90 text-sky-700 dark:border-sky-500/40 dark:bg-sky-900/20 dark:text-sky-200"
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
          <div className="min-w-0 flex-1">
            <span
              className={`flex w-full min-w-0 items-baseline gap-1 text-left font-semibold ${
                isHistorical
                  ? "text-amber-800 hover:text-amber-900 dark:text-amber-200 dark:hover:text-amber-100"
                  : isDeleted
                    ? "text-rose-700 hover:text-rose-800 dark:text-rose-200 dark:hover:text-rose-100"
                    : "text-slate-900 hover:text-primary-700 dark:text-slate-100 dark:hover:text-primary-200"
              }`}
            >
              <span className="truncate">{item.name}</span>
              {(isDeleted || isHistorical) && (
                <span
                  className={`shrink-0 ui-caption font-semibold ${
                    isHistorical
                      ? "text-amber-600 dark:text-amber-300"
                      : "text-rose-500 dark:text-rose-300"
                  }`}
                >
                  {isHistorical ? "(history)" : "(deleted)"}
                </span>
              )}
            </span>
            {!compactMode && (
              <div className="mt-1 flex min-w-0 flex-nowrap items-center gap-2 overflow-hidden ui-caption text-slate-500 dark:text-slate-400">
                <span className="rounded-md border border-slate-200 px-2 py-0.5 font-semibold dark:border-slate-700">
                  {resolveObjectTypeLabel(item)}
                </span>
                {(isDeleted || isHistorical) && (
                  <span
                    className={`rounded-md border px-2 py-0.5 font-semibold ${
                      isHistorical
                        ? "border-amber-200 text-amber-700 dark:border-amber-500/40 dark:text-amber-200"
                        : "border-rose-200 text-rose-700 dark:border-rose-500/40 dark:text-rose-200"
                    }`}
                  >
                    {isHistorical
                      ? "Version history"
                      : item.type === "folder"
                        ? "Delete markers"
                        : "Delete marker"}
                  </span>
                )}
                {item.storageClass && (
                  <span
                    className={`rounded-md border px-2 py-0.5 font-semibold ${
                      storageClassChipClasses[item.storageClass] ??
                      "border-slate-200 text-slate-600 dark:border-slate-700 dark:text-slate-300"
                    }`}
                  >
                    {item.storageClass}
                  </span>
                )}
              </div>
            )}
          </div>
        </button>
      </td>
      {visibleColumns.map((column) => (
        <td
          key={column.id}
          className={`px-2 ${rowCellClasses} !align-middle ui-body text-slate-600 dark:text-slate-300 whitespace-nowrap overflow-hidden text-ellipsis ${
            column.align === "right" ? "text-right" : ""
          }`}
        >
          <BrowserObjectColumnValue
            item={item}
            columnId={column.id}
            lazyEntry={lazyEntry}
          />
        </td>
      ))}
      <td className={`px-2 ${rowCellClasses} !align-middle text-right`}>
        <div className="flex items-center justify-end gap-1">
          {directActions.map((action) => (
            <BrowserDirectItemActionButton
              key={action.id}
              action={action}
              itemName={item.name}
              className={rowActionButtonClasses}
              onSelect={() => onRunAction(action.id)}
            />
          ))}
          <button
            type="button"
            className={rowActionButtonClasses}
            aria-label={`More actions for ${item.name}`}
            title="More"
            onClick={onOpenActions}
          >
            <MoreIcon />
          </button>
        </div>
      </td>
    </tr>
  );
}
