/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import {
  useEffect,
  useRef,
  type ChangeEvent,
  type ComponentProps,
  type RefObject,
} from "react";

import AnchoredPortalMenu from "../../components/ui/AnchoredPortalMenu";
import UiBadge from "../../components/ui/UiBadge";
import { useDismissibleLayer } from "../../components/ui/useDismissibleLayer";
import { cx, uiMenuClass } from "../../components/ui/styles";
import { BrowserToolbarActionMenuItem } from "./BrowserActionPresentation";
import BrowserBucketSelector from "./BrowserBucketSelector";
import BrowserPathNavigator from "./BrowserPathNavigator";
import {
  BrowserColumnsMenu,
  BrowserUploadQuickMenu,
} from "./BrowserToolbarMenus";
import BrowserToolbarToggleMenuItem from "./BrowserToolbarToggleMenuItem";
import type { BrowserActionId, BrowserActionState } from "./browserActions";
import {
  bulkDangerClasses,
  contextMenuItemClasses,
  contextMenuItemDisabledClasses,
  contextMenuSeparatorClasses,
  toolbarButtonClasses,
  toolbarIconButtonClasses,
  toolbarPrimaryClasses,
} from "./browserConstants";
import {
  ChevronDownIcon,
  CopyIcon,
  DownloadIcon,
  EyeIcon,
  FolderIcon,
  FolderPlusIcon,
  HistoryIcon,
  InfoIcon,
  ListIcon,
  MoreIcon,
  OpenIcon,
  RefreshIcon,
  SettingsIcon,
  SlidersIcon,
  TrashIcon,
  UploadIcon,
} from "./browserIcons";
import type { BrowserTransferAccessBadge } from "./browserTransferPresentation";

const toolbarShellClasses =
  "flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between";
const toolbarControlsGroupClasses = "flex shrink-0 items-center gap-1.5";
const floatingMenuClasses = cx(uiMenuClass, "overflow-hidden p-1.5");
const overflowStatusRowClasses =
  "flex items-start gap-3 px-1 py-1 ui-caption text-slate-600 dark:text-slate-300";
const overflowSectionTitleClasses =
  "px-1 py-1 ui-caption font-semibold text-slate-500 dark:text-slate-400";

type ToolbarToggle = {
  checked: boolean;
  onToggle: () => void;
};

type ToolbarColumns = Pick<
  ComponentProps<typeof BrowserColumnsMenu>,
  "columns" | "visibleColumnIds" | "onToggleColumn" | "onReset"
> & {
  open: boolean;
  summary: string;
  onOpenChange: (open: boolean) => void;
};

type BrowserToolbarProps = {
  bucketSelector: ComponentProps<typeof BrowserBucketSelector>;
  pathNavigator: ComponentProps<typeof BrowserPathNavigator>;
  deletedObjects: {
    showToggle: boolean;
    showDeleted: boolean;
    showRestore: boolean;
    restoreEnabled: boolean;
  };
  compactActions: {
    visible: boolean;
    uploadMenuOpen: boolean;
    canUploadFiles: boolean;
    canUploadFolder: boolean;
    canCreateFolder: boolean;
    canRefresh: boolean;
    onUploadMenuOpenChange: (open: boolean) => void;
  };
  selectionActions: {
    visible: boolean;
    mobileViewport: boolean;
    summary: string;
    canOpen: boolean;
    canCopy: boolean;
    canDownload: boolean;
    canDelete: boolean;
  };
  moreMenu: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    status: {
      visible: boolean;
      accessBadge: BrowserTransferAccessBadge | null;
      viewLabel?: string;
      operationsCount?: number;
      onOpenOperations: () => void;
    };
    layout: {
      folders?: ToolbarToggle;
      inspector?: ToolbarToggle;
      workbench?: ToolbarToggle;
    };
    columns?: ToolbarColumns;
    pathActions: BrowserActionState[];
    selectionActions: BrowserActionState[];
    selectionOverflow: boolean;
    sse?: {
      enabled: boolean;
      active: boolean;
      onOpen: () => void;
    };
  };
  fileInputRef: RefObject<HTMLInputElement>;
  folderInputRef: RefObject<HTMLInputElement>;
  onFileInputChange: (event: ChangeEvent<HTMLInputElement>) => void;
  onFolderInputChange: (event: ChangeEvent<HTMLInputElement>) => void;
  onRunPathAction: (actionId: BrowserActionId) => void;
  onRunSelectionAction: (actionId: BrowserActionId) => void;
};

export default function BrowserToolbar({
  bucketSelector,
  pathNavigator,
  deletedObjects,
  compactActions,
  selectionActions,
  moreMenu,
  fileInputRef,
  folderInputRef,
  onFileInputChange,
  onFolderInputChange,
  onRunPathAction,
  onRunSelectionAction,
}: BrowserToolbarProps) {
  const uploadButtonRef = useRef<HTMLButtonElement | null>(null);
  const uploadMenuRef = useRef<HTMLDivElement | null>(null);
  const moreButtonRef = useRef<HTMLButtonElement | null>(null);
  const moreMenuRef = useRef<HTMLDivElement | null>(null);
  const columnsButtonRef = useRef<HTMLButtonElement | null>(null);
  const columnsMenuRef = useRef<HTMLDivElement | null>(null);

  const hasStatusSection = moreMenu.status.visible;
  const hasLayoutSection = Boolean(
    moreMenu.layout.folders ||
      moreMenu.layout.inspector ||
      moreMenu.layout.workbench,
  );
  const hasColumnsSection = Boolean(moreMenu.columns);
  const hasPathActions = moreMenu.pathActions.length > 0;
  const hasSelectionActions = moreMenu.selectionActions.length > 0;
  const sse = moreMenu.sse;
  const hasSecondaryActionsSection =
    hasPathActions || hasSelectionActions || Boolean(sse);
  const hasMoreMenu =
    hasStatusSection ||
    hasLayoutSection ||
    hasColumnsSection ||
    hasSecondaryActionsSection;
  const moreOpen = moreMenu.open;
  const onMoreOpenChange = moreMenu.onOpenChange;
  const columnsOpen = moreMenu.columns?.open ?? false;
  const onColumnsOpenChange = moreMenu.columns?.onOpenChange;

  const closeMoreMenu = () => {
    moreMenu.columns?.onOpenChange(false);
    moreMenu.onOpenChange(false);
  };
  const runMoreAction = (action: () => void) => {
    closeMoreMenu();
    action();
  };
  const toggleMoreMenu = () => {
    compactActions.onUploadMenuOpenChange(false);
    moreMenu.columns?.onOpenChange(false);
    moreMenu.onOpenChange(!moreMenu.open);
  };
  const toggleUploadMenu = () => {
    closeMoreMenu();
    compactActions.onUploadMenuOpenChange(!compactActions.uploadMenuOpen);
  };
  const runUploadAction = (actionId: "uploadFiles" | "uploadFolder") => {
    compactActions.onUploadMenuOpenChange(false);
    onRunPathAction(actionId);
  };

  useDismissibleLayer({
    open: moreMenu.open,
    insideRefs: [
      moreButtonRef,
      moreMenuRef,
      columnsButtonRef,
      columnsMenuRef,
    ],
    onDismiss: closeMoreMenu,
  });

  useDismissibleLayer({
    open: compactActions.uploadMenuOpen,
    insideRefs: [uploadButtonRef, uploadMenuRef],
    onDismiss: () => compactActions.onUploadMenuOpenChange(false),
  });

  useEffect(() => {
    if (!hasMoreMenu && moreOpen) {
      onMoreOpenChange(false);
    }
  }, [hasMoreMenu, moreOpen, onMoreOpenChange]);

  useEffect(() => {
    if (!moreOpen && columnsOpen) {
      onColumnsOpenChange?.(false);
    }
  }, [columnsOpen, moreOpen, onColumnsOpenChange]);

  return (
    <div className="flex flex-col gap-2.5">
      <div
        role="toolbar"
        aria-label="Browser context bar"
        className={toolbarShellClasses}
      >
        <div className="flex min-w-0 flex-1 flex-col gap-2 md:flex-row md:items-stretch lg:items-center">
          <BrowserBucketSelector {...bucketSelector} />
          <BrowserPathNavigator {...pathNavigator} />
        </div>
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
          {deletedObjects.showToggle && (
            <button
              type="button"
              className={toolbarButtonClasses}
              aria-pressed={deletedObjects.showDeleted}
              aria-label={
                deletedObjects.showDeleted
                  ? "Hide deleted files"
                  : "Show deleted files"
              }
              onClick={() => onRunPathAction("toggleShowDeleted")}
            >
              <TrashIcon className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">
                {deletedObjects.showDeleted
                  ? "Hide deleted files"
                  : "Show deleted files"}
              </span>
              <span className="sm:hidden">
                {deletedObjects.showDeleted ? "Hide deleted" : "Show deleted"}
              </span>
            </button>
          )}
          {deletedObjects.showRestore && (
            <button
              type="button"
              className={toolbarButtonClasses}
              aria-label="Restore deleted files in this folder"
              onClick={() => onRunPathAction("restore")}
              disabled={!deletedObjects.restoreEnabled}
            >
              <HistoryIcon className="h-3.5 w-3.5" />
              <span className="hidden lg:inline">
                Restore deleted files in this folder
              </span>
              <span className="lg:hidden">Restore folder</span>
            </button>
          )}
          {compactActions.visible && (
            <div className={toolbarControlsGroupClasses}>
              <button
                ref={uploadButtonRef}
                type="button"
                className={toolbarIconButtonClasses}
                onClick={toggleUploadMenu}
                disabled={
                  !compactActions.canUploadFiles &&
                  !compactActions.canUploadFolder
                }
                aria-haspopup={
                  compactActions.canUploadFiles || compactActions.canUploadFolder
                    ? "menu"
                    : undefined
                }
                aria-expanded={
                  compactActions.canUploadFiles || compactActions.canUploadFolder
                    ? compactActions.uploadMenuOpen
                    : undefined
                }
                aria-label="Upload"
                title="Upload"
              >
                <UploadIcon className="h-3.5 w-3.5" />
              </button>
              <BrowserUploadQuickMenu
                open={compactActions.uploadMenuOpen}
                anchorRef={uploadButtonRef}
                menuRef={uploadMenuRef}
                canUploadFiles={compactActions.canUploadFiles}
                canUploadFolder={compactActions.canUploadFolder}
                onUploadFiles={() => runUploadAction("uploadFiles")}
                onUploadFolder={() => runUploadAction("uploadFolder")}
              />
              <button
                type="button"
                className={toolbarIconButtonClasses}
                onClick={() => onRunPathAction("newFolder")}
                disabled={!compactActions.canCreateFolder}
                aria-label="New folder"
                title="New folder"
              >
                <FolderPlusIcon className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                className={toolbarIconButtonClasses}
                onClick={() => onRunPathAction("refresh")}
                disabled={!compactActions.canRefresh}
                aria-label="Refresh"
                title="Refresh"
              >
                <RefreshIcon className="h-3.5 w-3.5" />
              </button>
              <button
                ref={moreButtonRef}
                type="button"
                className={toolbarIconButtonClasses}
                onClick={toggleMoreMenu}
                disabled={!hasMoreMenu}
                aria-haspopup={hasMoreMenu ? "menu" : undefined}
                aria-expanded={hasMoreMenu ? moreMenu.open : undefined}
                aria-label="More"
                title="More"
              >
                <MoreIcon className="h-3.5 w-3.5" />
              </button>
            </div>
          )}
        </div>
      </div>

      {selectionActions.visible && !selectionActions.mobileViewport && (
        <div
          role="toolbar"
          aria-label="Browser actions bar"
          className="sticky top-0 z-20 hidden gap-3 rounded-xl border border-slate-200 bg-slate-50/95 px-3 py-2.5 shadow-sm backdrop-blur dark:border-slate-700 dark:bg-slate-900/90 md:flex md:items-center md:justify-between"
        >
          <div className="min-w-0 flex items-center">
            <div className="min-w-0 rounded-md border border-slate-200 bg-white px-3 py-1.5 shadow-sm dark:border-slate-700 dark:bg-slate-900">
              <p className="ui-caption truncate font-semibold text-primary-700 dark:text-primary-100">
                {selectionActions.summary}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 sm:justify-end">
            <button
              type="button"
              className={toolbarButtonClasses}
              onClick={() => onRunSelectionAction("open")}
              disabled={!selectionActions.canOpen}
            >
              <OpenIcon className="h-3.5 w-3.5" />
              Open
            </button>
            <button
              type="button"
              className={toolbarButtonClasses}
              onClick={() => onRunSelectionAction("copy")}
              disabled={!selectionActions.canCopy}
            >
              <CopyIcon className="h-3.5 w-3.5" />
              Copy
            </button>
            <button
              type="button"
              className={toolbarPrimaryClasses}
              onClick={() => onRunSelectionAction("download")}
              disabled={!selectionActions.canDownload}
            >
              <DownloadIcon className="h-3.5 w-3.5" />
              Download
            </button>
            <button
              type="button"
              className={bulkDangerClasses}
              onClick={() => onRunSelectionAction("delete")}
              disabled={!selectionActions.canDelete}
            >
              <TrashIcon className="h-3.5 w-3.5" />
              Delete
            </button>
            <button
              ref={moreButtonRef}
              type="button"
              className={toolbarButtonClasses}
              onClick={toggleMoreMenu}
              disabled={!hasMoreMenu}
              aria-haspopup={hasMoreMenu ? "menu" : undefined}
              aria-expanded={hasMoreMenu ? moreMenu.open : undefined}
              aria-label="More"
              title="More"
            >
              <MoreIcon className="h-3.5 w-3.5" />
              More
            </button>
          </div>
        </div>
      )}

      {hasMoreMenu && (
        <AnchoredPortalMenu
          open={moreMenu.open}
          anchorRef={moreButtonRef}
          placement="bottom-end"
          offset={6}
          minWidth={288}
          className={`w-80 ${floatingMenuClasses}`}
        >
          <div
            ref={moreMenuRef}
            role="menu"
            aria-label="More"
            className="max-h-[min(70vh,28rem)] overflow-y-auto"
          >
            {hasStatusSection && (
              <>
                <p className={overflowSectionTitleClasses}>Status</p>
                {moreMenu.status.accessBadge && (
                  <div
                    className={overflowStatusRowClasses}
                    title={moreMenu.status.accessBadge.title}
                  >
                    <span
                      className={`mt-0.5 inline-flex h-2.5 w-2.5 shrink-0 rounded-full border ${moreMenu.status.accessBadge.indicatorClassName}`}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-2">
                        <p className="font-semibold text-slate-700 dark:text-slate-100">
                          Transfers
                        </p>
                        <UiBadge
                          tone={moreMenu.status.accessBadge.tone}
                          className="shrink-0 whitespace-nowrap px-1.5 py-0.5 text-[10px] leading-4"
                          title={moreMenu.status.accessBadge.title}
                        >
                          {moreMenu.status.accessBadge.label}
                        </UiBadge>
                      </div>
                      <p className="text-slate-500 dark:text-slate-400">
                        {moreMenu.status.accessBadge.title}
                      </p>
                    </div>
                  </div>
                )}
                {moreMenu.status.viewLabel && (
                  <div className={overflowStatusRowClasses}>
                    <EyeIcon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400 dark:text-slate-500" />
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold text-slate-700 dark:text-slate-100">
                        View
                      </p>
                      <p className="text-slate-500 dark:text-slate-400">
                        {moreMenu.status.viewLabel}
                      </p>
                    </div>
                  </div>
                )}
                {moreMenu.status.operationsCount !== undefined && (
                  <button
                    type="button"
                    role="menuitem"
                    aria-label="Operations overview"
                    className={contextMenuItemClasses}
                    onClick={() =>
                      runMoreAction(moreMenu.status.onOpenOperations)
                    }
                  >
                    <ListIcon className="h-3.5 w-3.5" />
                    <span className="min-w-0 flex-1">
                      <span className="block">Operations overview</span>
                      <span
                        aria-hidden="true"
                        className="block text-[11px] font-medium leading-tight text-slate-400 dark:text-slate-500"
                      >
                        {moreMenu.status.operationsCount === 1
                          ? "1 operation"
                          : `${moreMenu.status.operationsCount} operations`}
                      </span>
                    </span>
                  </button>
                )}
              </>
            )}

            {hasLayoutSection && (
              <>
                {hasStatusSection && (
                  <div className={contextMenuSeparatorClasses} />
                )}
                <p className={overflowSectionTitleClasses}>Layout</p>
                {moreMenu.layout.folders && (
                  <BrowserToolbarToggleMenuItem
                    label="Folders panel"
                    icon={<FolderIcon className="h-3.5 w-3.5" />}
                    {...moreMenu.layout.folders}
                  />
                )}
                {moreMenu.layout.inspector && (
                  <BrowserToolbarToggleMenuItem
                    label="Inspector panel"
                    icon={<InfoIcon className="h-3.5 w-3.5" />}
                    {...moreMenu.layout.inspector}
                  />
                )}
                {moreMenu.layout.workbench && (
                  <BrowserToolbarToggleMenuItem
                    label="Workbench layout"
                    icon={<SlidersIcon className="h-3.5 w-3.5" />}
                    {...moreMenu.layout.workbench}
                  />
                )}
              </>
            )}

            {moreMenu.columns && (
              <>
                {(hasStatusSection || hasLayoutSection) && (
                  <div className={contextMenuSeparatorClasses} />
                )}
                <p className={overflowSectionTitleClasses}>Columns</p>
                <button
                  ref={columnsButtonRef}
                  type="button"
                  role="menuitem"
                  aria-haspopup="menu"
                  aria-expanded={moreMenu.columns.open}
                  className={contextMenuItemClasses}
                  onClick={() =>
                    moreMenu.columns?.onOpenChange(!moreMenu.columns.open)
                  }
                >
                  <SlidersIcon className="h-3.5 w-3.5" />
                  <span className="min-w-0 flex-1">
                    <span className="block">Columns</span>
                    <span className="block text-[11px] font-medium leading-tight text-slate-400 dark:text-slate-500">
                      {moreMenu.columns.summary}
                    </span>
                  </span>
                  <ChevronDownIcon
                    className={`h-3.5 w-3.5 shrink-0 transition ${
                      moreMenu.columns.open ? "" : "-rotate-90"
                    }`}
                  />
                </button>
                <BrowserColumnsMenu
                  open={moreMenu.columns.open}
                  anchorRef={columnsButtonRef}
                  menuRef={columnsMenuRef}
                  columns={moreMenu.columns.columns}
                  visibleColumnIds={moreMenu.columns.visibleColumnIds}
                  onToggleColumn={moreMenu.columns.onToggleColumn}
                  onReset={moreMenu.columns.onReset}
                />
              </>
            )}

            {hasSecondaryActionsSection && (
              <>
                {(hasStatusSection ||
                  hasLayoutSection ||
                  hasColumnsSection) && (
                  <div className={contextMenuSeparatorClasses} />
                )}
                {hasPathActions && (
                  <>
                    <p className={overflowSectionTitleClasses}>Current path</p>
                    {moreMenu.pathActions.map((action) => (
                      <BrowserToolbarActionMenuItem
                        key={action.id}
                        action={action}
                        onSelect={() =>
                          runMoreAction(() => onRunPathAction(action.id))
                        }
                      />
                    ))}
                  </>
                )}
                {hasSelectionActions && (
                  <>
                    {hasPathActions && (
                      <div className={contextMenuSeparatorClasses} />
                    )}
                    <p className={overflowSectionTitleClasses}>
                      {moreMenu.selectionOverflow
                        ? "Selection overflow"
                        : "Selection actions"}
                    </p>
                    {moreMenu.selectionActions.map((action) => (
                      <BrowserToolbarActionMenuItem
                        key={action.id}
                        action={action}
                        onSelect={() =>
                          runMoreAction(() => onRunSelectionAction(action.id))
                        }
                      />
                    ))}
                  </>
                )}
                {sse && (
                  <>
                    {(hasPathActions || hasSelectionActions) && (
                      <div className={contextMenuSeparatorClasses} />
                    )}
                    <p className={overflowSectionTitleClasses}>Security</p>
                    <button
                      type="button"
                      role="menuitem"
                      className={`${contextMenuItemClasses} ${
                        !sse.enabled
                          ? contextMenuItemDisabledClasses
                          : ""
                      }`}
                      onClick={() => runMoreAction(sse.onOpen)}
                      disabled={!sse.enabled}
                      title={
                        sse.active
                          ? "SSE-C enabled for this bucket."
                          : "Configure SSE-C key for this bucket."
                      }
                    >
                      <SettingsIcon className="h-3.5 w-3.5" />
                      <span className="min-w-0 flex-1">
                        <span className="block">SSE-C</span>
                        <span className="block text-[11px] font-medium leading-tight text-slate-400 dark:text-slate-500">
                          {sse.active
                            ? "Enabled for this bucket"
                            : "Configure customer key"}
                        </span>
                      </span>
                      <span
                        className={`ml-2 rounded-full px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                          sse.active
                            ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-100"
                            : "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-300"
                        }`}
                      >
                        {sse.active ? "On" : "Off"}
                      </span>
                    </button>
                  </>
                )}
              </>
            )}
          </div>
        </AnchoredPortalMenu>
      )}

      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={onFileInputChange}
      />
      <input
        ref={folderInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={onFolderInputChange}
      />
    </div>
  );
}
