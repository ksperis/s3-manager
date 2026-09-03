/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import {
  useEffect,
  useRef,
  useState,
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
  toolbarDangerIconButtonClasses,
  toolbarIconButtonClasses,
  toolbarPrimaryClasses,
  toolbarPrimaryIconButtonClasses,
} from "./browserConstants";
import {
  ChevronDownIcon,
  CompactIcon,
  CopyIcon,
  DownloadIcon,
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
  summary: string;
};

type BrowserToolbarProps = {
  compactMode: boolean;
  bucketSelector: ComponentProps<typeof BrowserBucketSelector>;
  pathNavigator: ComponentProps<typeof BrowserPathNavigator>;
  deletedObjects: {
    showToggle: boolean;
    showDeleted: boolean;
    showRestore: boolean;
    restoreEnabled: boolean;
  };
  contextActions: {
    visible: boolean;
    canUploadFiles: boolean;
    canUploadFolder: boolean;
    canCreateFolder: boolean;
    canRefresh: boolean;
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
  menuResetKey: string;
  moreMenu: {
    view?: {
      compactMode: boolean;
      onSetCompactMode: (compact: boolean) => void;
    };
    status: {
      visible: boolean;
      accessBadge: BrowserTransferAccessBadge | null;
      operationsCount?: number;
      onOpenOperations: () => void;
    };
    layout: {
      folders?: ToolbarToggle;
      inspector?: ToolbarToggle;
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
  compactMode,
  bucketSelector,
  pathNavigator,
  deletedObjects,
  contextActions,
  selectionActions,
  menuResetKey,
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
  const [uploadMenuOpen, setUploadMenuOpen] = useState(false);
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);
  const [columnsMenuOpen, setColumnsMenuOpen] = useState(false);
  const toolbarShellClasses = compactMode
    ? "flex flex-col gap-2 md:flex-row md:items-center md:justify-between"
    : "flex flex-col gap-2 xl:flex-row xl:items-center xl:justify-between";
  const toolbarActionsClasses = compactMode
    ? "flex shrink-0 flex-wrap items-center justify-end gap-2"
    : "flex w-full flex-wrap items-center justify-end gap-2 xl:w-auto";
  const selectionActionsClasses = compactMode
    ? "hidden shrink-0 items-center gap-1.5 md:flex"
    : "hidden w-full shrink-0 flex-wrap items-center justify-end gap-2 md:flex xl:w-auto";

  const hasViewSection = Boolean(moreMenu.view);
  const hasStatusSection = moreMenu.status.visible;
  const hasLayoutSection = Boolean(
    moreMenu.layout.folders || moreMenu.layout.inspector,
  );
  const hasColumnsSection = Boolean(moreMenu.columns);
  const hasPathActions = moreMenu.pathActions.length > 0;
  const hasSelectionActions = moreMenu.selectionActions.length > 0;
  const sse = moreMenu.sse;
  const hasSecondaryActionsSection =
    hasPathActions || hasSelectionActions || Boolean(sse);
  const hasMoreMenu =
    hasViewSection ||
    hasStatusSection ||
    hasLayoutSection ||
    hasColumnsSection ||
    hasSecondaryActionsSection;
  const closeMoreMenu = () => {
    setColumnsMenuOpen(false);
    setMoreMenuOpen(false);
  };
  const runMoreAction = (action: () => void) => {
    closeMoreMenu();
    action();
  };
  const toggleMoreMenu = () => {
    setUploadMenuOpen(false);
    setColumnsMenuOpen(false);
    setMoreMenuOpen((current) => !current);
  };
  const toggleUploadMenu = () => {
    closeMoreMenu();
    setUploadMenuOpen((current) => !current);
  };
  const runUploadAction = (actionId: "uploadFiles" | "uploadFolder") => {
    setUploadMenuOpen(false);
    onRunPathAction(actionId);
  };

  useDismissibleLayer({
    open: moreMenuOpen,
    insideRefs: [
      moreButtonRef,
      moreMenuRef,
      columnsButtonRef,
      columnsMenuRef,
    ],
    onDismiss: closeMoreMenu,
  });

  useDismissibleLayer({
    open: uploadMenuOpen,
    insideRefs: [uploadButtonRef, uploadMenuRef],
    onDismiss: () => setUploadMenuOpen(false),
  });

  useEffect(() => {
    setMoreMenuOpen(false);
  }, [menuResetKey]);

  useEffect(() => {
    if (!hasMoreMenu && moreMenuOpen) {
      setMoreMenuOpen(false);
    }
  }, [hasMoreMenu, moreMenuOpen]);

  useEffect(() => {
    if (!moreMenuOpen && columnsMenuOpen) {
      setColumnsMenuOpen(false);
    }
  }, [columnsMenuOpen, moreMenuOpen]);

  return (
    <div className="flex flex-col gap-2.5">
      <div
        role="toolbar"
        aria-label="Browser context bar"
        data-density={compactMode ? "compact" : "comfortable"}
        className={toolbarShellClasses}
      >
        <div className="flex min-w-0 w-full flex-1 flex-col gap-2 md:flex-row md:items-stretch lg:items-center">
          <BrowserBucketSelector {...bucketSelector} />
          <BrowserPathNavigator {...pathNavigator} />
        </div>
        <div className={toolbarActionsClasses}>
          {deletedObjects.showToggle && (
            <button
              type="button"
              className={compactMode ? toolbarIconButtonClasses : toolbarButtonClasses}
              aria-pressed={deletedObjects.showDeleted}
              aria-label={
                deletedObjects.showDeleted
                  ? "Hide deleted files"
                  : "Show deleted files"
              }
              onClick={() => onRunPathAction("toggleShowDeleted")}
              title={
                deletedObjects.showDeleted
                  ? "Hide deleted files"
                  : "Show deleted files"
              }
            >
              <TrashIcon className="h-3.5 w-3.5" />
              {!compactMode && (
                <span>
                  {deletedObjects.showDeleted
                    ? "Hide deleted files"
                    : "Show deleted files"}
                </span>
              )}
            </button>
          )}
          {deletedObjects.showRestore && (
            <button
              type="button"
              className={compactMode ? toolbarIconButtonClasses : toolbarButtonClasses}
              aria-label="Restore deleted files in this folder"
              title="Restore deleted files in this folder"
              onClick={() => onRunPathAction("restore")}
              disabled={!deletedObjects.restoreEnabled}
            >
              <HistoryIcon className="h-3.5 w-3.5" />
              {!compactMode && <span>Restore deleted files in this folder</span>}
            </button>
          )}
          {contextActions.visible && (
            <div className={compactMode ? toolbarControlsGroupClasses : "flex shrink-0 flex-wrap items-center gap-2"}>
              <button
                ref={uploadButtonRef}
                type="button"
                className={compactMode ? toolbarPrimaryIconButtonClasses : toolbarPrimaryClasses}
                onClick={toggleUploadMenu}
                disabled={
                  !contextActions.canUploadFiles &&
                  !contextActions.canUploadFolder
                }
                aria-haspopup={
                  contextActions.canUploadFiles || contextActions.canUploadFolder
                    ? "menu"
                    : undefined
                }
                aria-expanded={
                  contextActions.canUploadFiles || contextActions.canUploadFolder
                    ? uploadMenuOpen
                    : undefined
                }
                aria-label="Upload"
                title="Upload"
              >
                <UploadIcon className="h-3.5 w-3.5" />
                {!compactMode && <span>Upload</span>}
              </button>
              <BrowserUploadQuickMenu
                open={uploadMenuOpen}
                anchorRef={uploadButtonRef}
                menuRef={uploadMenuRef}
                canUploadFiles={contextActions.canUploadFiles}
                canUploadFolder={contextActions.canUploadFolder}
                onUploadFiles={() => runUploadAction("uploadFiles")}
                onUploadFolder={() => runUploadAction("uploadFolder")}
              />
              <button
                type="button"
                className={compactMode ? toolbarIconButtonClasses : toolbarButtonClasses}
                onClick={() => onRunPathAction("newFolder")}
                disabled={!contextActions.canCreateFolder}
                aria-label="New folder"
                title="New folder"
              >
                <FolderPlusIcon className="h-3.5 w-3.5" />
                {!compactMode && <span>New folder</span>}
              </button>
              <button
                type="button"
                className={compactMode ? toolbarIconButtonClasses : toolbarButtonClasses}
                onClick={() => onRunPathAction("refresh")}
                disabled={!contextActions.canRefresh}
                aria-label="Refresh"
                title="Refresh"
              >
                <RefreshIcon className="h-3.5 w-3.5" />
                {!compactMode && <span>Refresh</span>}
              </button>
              <button
                ref={moreButtonRef}
                type="button"
                className={compactMode ? toolbarIconButtonClasses : toolbarButtonClasses}
                onClick={toggleMoreMenu}
                disabled={!hasMoreMenu}
                aria-haspopup={hasMoreMenu ? "menu" : undefined}
                aria-expanded={hasMoreMenu ? moreMenuOpen : undefined}
                aria-label="More"
                title="More"
              >
                <MoreIcon className="h-3.5 w-3.5" />
                {!compactMode && <span>More</span>}
              </button>
            </div>
          )}
          {selectionActions.visible && !selectionActions.mobileViewport && (
            <div className={selectionActionsClasses}>
              <p
                role="status"
                aria-live="polite"
                className="max-w-48 truncate rounded-md border border-[color:var(--ui-border)] bg-[var(--ui-surface-muted)] px-2.5 py-1.5 ui-caption font-semibold text-primary-700 dark:text-primary-100"
              >
                {selectionActions.summary}
              </p>
              <button
                type="button"
                className={compactMode ? toolbarIconButtonClasses : toolbarButtonClasses}
                onClick={() => onRunSelectionAction("open")}
                disabled={!selectionActions.canOpen}
                aria-label="Open"
                title="Open"
              >
                <OpenIcon className="h-3.5 w-3.5" />
                {!compactMode && <span>Open</span>}
              </button>
              <button
                type="button"
                className={compactMode ? toolbarIconButtonClasses : toolbarButtonClasses}
                onClick={() => onRunSelectionAction("copy")}
                disabled={!selectionActions.canCopy}
                aria-label="Copy"
                title="Copy"
              >
                <CopyIcon className="h-3.5 w-3.5" />
                {!compactMode && <span>Copy</span>}
              </button>
              <button
                type="button"
                className={compactMode ? toolbarPrimaryIconButtonClasses : toolbarPrimaryClasses}
                onClick={() => onRunSelectionAction("download")}
                disabled={!selectionActions.canDownload}
                aria-label="Download"
                title="Download"
              >
                <DownloadIcon className="h-3.5 w-3.5" />
                {!compactMode && <span>Download</span>}
              </button>
              <button
                type="button"
                className={compactMode ? toolbarDangerIconButtonClasses : bulkDangerClasses}
                onClick={() => onRunSelectionAction("delete")}
                disabled={!selectionActions.canDelete}
                aria-label="Delete"
                title="Delete"
              >
                <TrashIcon className="h-3.5 w-3.5" />
                {!compactMode && <span>Delete</span>}
              </button>
              <button
                ref={moreButtonRef}
                type="button"
                className={compactMode ? toolbarIconButtonClasses : toolbarButtonClasses}
                onClick={toggleMoreMenu}
                disabled={!hasMoreMenu}
                aria-haspopup={hasMoreMenu ? "menu" : undefined}
                aria-expanded={hasMoreMenu ? moreMenuOpen : undefined}
                aria-label="More"
                title="More"
              >
                <MoreIcon className="h-3.5 w-3.5" />
                {!compactMode && <span>More</span>}
              </button>
            </div>
          )}
        </div>
      </div>

      {hasMoreMenu && (
        <AnchoredPortalMenu
          open={moreMenuOpen}
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
            {moreMenu.view && (
              <>
                <p className={overflowSectionTitleClasses}>View</p>
                <button
                  type="button"
                  role="menuitemradio"
                  aria-checked={!moreMenu.view.compactMode}
                  className={contextMenuItemClasses}
                  onClick={() =>
                    runMoreAction(() =>
                      moreMenu.view?.onSetCompactMode(false),
                    )
                  }
                >
                  <ListIcon className="h-3.5 w-3.5" />
                  Comfortable
                  {!moreMenu.view.compactMode && (
                    <span
                      aria-hidden="true"
                      className="ml-auto text-primary-600 dark:text-primary-300"
                    >
                      ✓
                    </span>
                  )}
                </button>
                <button
                  type="button"
                  role="menuitemradio"
                  aria-checked={moreMenu.view.compactMode}
                  className={contextMenuItemClasses}
                  onClick={() =>
                    runMoreAction(() =>
                      moreMenu.view?.onSetCompactMode(true),
                    )
                  }
                >
                  <CompactIcon className="h-3.5 w-3.5" />
                  Compact
                  {moreMenu.view.compactMode && (
                    <span
                      aria-hidden="true"
                      className="ml-auto text-primary-600 dark:text-primary-300"
                    >
                      ✓
                    </span>
                  )}
                </button>
              </>
            )}

            {hasStatusSection && (
              <>
                {hasViewSection && (
                  <div className={contextMenuSeparatorClasses} />
                )}
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
                {(hasViewSection || hasStatusSection) && (
                  <div className={contextMenuSeparatorClasses} />
                )}
                <p className={overflowSectionTitleClasses}>Panels</p>
                {moreMenu.layout.folders && (
                  <BrowserToolbarToggleMenuItem
                    label="Folders panel"
                    icon={<FolderIcon className="h-3.5 w-3.5" />}
                    {...moreMenu.layout.folders}
                  />
                )}
                {moreMenu.layout.inspector && (
                  <BrowserToolbarToggleMenuItem
                    label="Details panel"
                    icon={<InfoIcon className="h-3.5 w-3.5" />}
                    {...moreMenu.layout.inspector}
                  />
                )}
              </>
            )}

            {moreMenu.columns && (
              <>
                {(hasViewSection || hasStatusSection || hasLayoutSection) && (
                  <div className={contextMenuSeparatorClasses} />
                )}
                <p className={overflowSectionTitleClasses}>Columns</p>
                <button
                  ref={columnsButtonRef}
                  type="button"
                  role="menuitem"
                  aria-haspopup="menu"
                  aria-expanded={columnsMenuOpen}
                  className={contextMenuItemClasses}
                  onClick={() => setColumnsMenuOpen((current) => !current)}
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
                      columnsMenuOpen ? "" : "-rotate-90"
                    }`}
                  />
                </button>
                <BrowserColumnsMenu
                  open={columnsMenuOpen}
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
                  hasViewSection ||
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
