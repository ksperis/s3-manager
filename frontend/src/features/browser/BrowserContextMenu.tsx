/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import type { RefObject } from "react";
import {
  contextMenuItemClasses,
  contextMenuItemDangerClasses,
  contextMenuItemDisabledClasses,
  contextMenuSeparatorClasses,
} from "./browserConstants";
import {
  CompactIcon,
  CutIcon,
  CopyIcon,
  DownloadIcon,
  EyeIcon,
  FolderIcon,
  FolderPlusIcon,
  HistoryIcon,
  InfoIcon,
  LinkIcon,
  ListIcon,
  OpenIcon,
  PasteIcon,
  RefreshIcon,
  SettingsIcon,
  SlidersIcon,
  TrashIcon,
  UploadIcon,
} from "./browserIcons";
import {
  CONTEXT_MENU_ITEM_ACTION_IDS,
  CONTEXT_MENU_PATH_ACTION_IDS,
  CONTEXT_MENU_PATH_LAYOUT_ACTION_IDS,
  CONTEXT_MENU_SELECTION_ACTION_IDS,
  getVisibleBrowserActions,
  isBrowserItemPreviewAvailable,
  resolveBrowserActions,
  runBrowserAction,
  type BrowserActionId,
  type BrowserCapabilityFacts,
  type BrowserFunctionalProfile,
} from "./browserActions";
import type { BrowserItem, ClipboardState, ContextMenuState } from "./browserTypes";

type HeaderConfigColumnOption = {
  id: string;
  label: string;
};

type BrowserContextMenuProps = {
  contextMenu: ContextMenuState | null;
  contextMenuRef: RefObject<HTMLDivElement>;
  bucketName: string;
  currentPath: string;
  hasS3AccountContext: boolean;
  versioningEnabled: boolean;
  showFolderItems: boolean;
  showDeletedObjects: boolean;
  allowInspectorPanel?: boolean;
  canPaste: boolean;
  copyUrlDisabled?: boolean;
  copyUrlDisabledReason?: string;
  publicLinkAvailable?: boolean;
  restoreAvailable?: boolean;
  multipartUploadsAvailable?: boolean;
  bucketConfigurationAvailable?: boolean;
  functionalProfile: BrowserFunctionalProfile;
  capabilityFacts: BrowserCapabilityFacts;
  clipboard: ClipboardState | null;
  fileInputRef: RefObject<HTMLInputElement>;
  folderInputRef: RefObject<HTMLInputElement>;
  onClose: () => void;
  onNewFolder: () => void;
  onPasteItems: () => void;
  onOpenPrefixVersions: () => void;
  onOpenCleanupVersions: () => void;
  onOpenMultipartUploads: () => void;
  onConfigureBucket: () => void;
  onDownloadTarget: (item: BrowserItem) => void;
  onCreatePublicLink: (item: BrowserItem) => void;
  onRestoreDeletedItem?: (item: BrowserItem) => void;
  onPreviewItem: (item: BrowserItem) => void;
  onCopyUrl: (item: BrowserItem | null) => void;
  onCopyPath: (path: string) => void;
  onCopyItems: (items: BrowserItem[]) => void;
  onCutItems: (items: BrowserItem[]) => void;
  onOpenBulkAttributes: (items: BrowserItem[]) => void;
  onOpenBulkRestore: (items: BrowserItem[]) => void;
  onOpenObjectVersions: (item: BrowserItem) => void;
  onOpenAdvanced: (item: BrowserItem) => void;
  onOpenProperties: (item: BrowserItem) => void;
  onDeleteItems: (items: BrowserItem[]) => void;
  onDownloadFolder: (item: BrowserItem) => void;
  onDownloadItems: (items: BrowserItem[]) => void;
  onOpenItem: (item: BrowserItem) => void;
  onOpenDetails: (item: BrowserItem) => void;
  onToggleShowFolders: () => void;
  onToggleShowDeleted: () => void;
  isMainBrowserPath?: boolean;
  compactMode?: boolean;
  onSetCompactMode?: (value: boolean) => void;
  columnOptions?: HeaderConfigColumnOption[];
  visibleColumns?: ReadonlySet<string>;
  onToggleVisibleColumn?: (columnId: string) => void;
  onResetVisibleColumns?: () => void;
};

export default function BrowserContextMenu({
  contextMenu,
  contextMenuRef,
  bucketName,
  currentPath,
  hasS3AccountContext,
  versioningEnabled,
  showFolderItems,
  showDeletedObjects,
  allowInspectorPanel = true,
  canPaste,
  copyUrlDisabled = false,
  copyUrlDisabledReason,
  publicLinkAvailable = false,
  restoreAvailable = false,
  multipartUploadsAvailable = false,
  bucketConfigurationAvailable = false,
  functionalProfile,
  capabilityFacts,
  clipboard,
  fileInputRef,
  folderInputRef,
  onClose,
  onNewFolder,
  onPasteItems,
  onOpenPrefixVersions,
  onOpenCleanupVersions,
  onOpenMultipartUploads,
  onConfigureBucket,
  onDownloadTarget,
  onCreatePublicLink,
  onRestoreDeletedItem,
  onPreviewItem,
  onCopyUrl,
  onCopyPath,
  onCopyItems,
  onCutItems,
  onOpenBulkAttributes,
  onOpenBulkRestore,
  onOpenObjectVersions,
  onOpenAdvanced,
  onOpenProperties,
  onDeleteItems,
  onDownloadFolder,
  onDownloadItems,
  onOpenItem,
  onOpenDetails,
  onToggleShowFolders,
  onToggleShowDeleted,
  isMainBrowserPath = false,
  compactMode = true,
  onSetCompactMode,
  columnOptions = [],
  visibleColumns,
  onToggleVisibleColumn,
  onResetVisibleColumns,
}: BrowserContextMenuProps) {
  if (!contextMenu) return null;

  const contextItem = contextMenu.kind === "item" ? contextMenu.item ?? null : null;
  const pathActionStates = resolveBrowserActions({
    scope: "path",
    bucketName,
    hasS3AccountContext,
    versioningEnabled,
    canPaste,
    clipboardMode: clipboard?.mode ?? null,
    currentPath,
    showFolderItems,
    showDeletedObjects,
    functionalProfile,
    capabilityFacts,
    multipartUploadsAvailable,
    bucketConfigurationAvailable,
  });
  const itemActionStates = contextItem
    ? resolveBrowserActions({
          scope: "item",
          items: [contextItem],
          bucketName,
          hasS3AccountContext,
          versioningEnabled,
          canPaste,
          clipboardMode: clipboard?.mode ?? null,
          copyUrlDisabled,
          copyUrlDisabledReason,
          publicLinkAvailable,
          restoreAvailable,
          inspectorAvailable: allowInspectorPanel,
          functionalProfile,
          capabilityFacts,
          previewAvailable: isBrowserItemPreviewAvailable(contextItem),
        })
    : null;
  const selectionItems = contextMenu.kind === "selection" ? contextMenu.items ?? [] : [];
  const selectionActionStates = contextMenu.kind === "selection"
    ? resolveBrowserActions({
          scope: "selection",
          items: selectionItems,
          bucketName,
          hasS3AccountContext,
          versioningEnabled,
          canPaste,
          clipboardMode: clipboard?.mode ?? null,
          copyUrlDisabled,
          copyUrlDisabledReason,
          functionalProfile,
          capabilityFacts,
        })
    : null;
  const visiblePathActions = getVisibleBrowserActions(pathActionStates, CONTEXT_MENU_PATH_ACTION_IDS);
  const visiblePathLayoutActions = getVisibleBrowserActions(pathActionStates, CONTEXT_MENU_PATH_LAYOUT_ACTION_IDS);
  const visibleItemActions = itemActionStates ? getVisibleBrowserActions(itemActionStates, CONTEXT_MENU_ITEM_ACTION_IDS) : [];
  const visibleSelectionActions = selectionActionStates
    ? getVisibleBrowserActions(selectionActionStates, CONTEXT_MENU_SELECTION_ACTION_IDS)
    : [];

  const runPathAction = (actionId: BrowserActionId) => {
    onClose();
    runBrowserAction(pathActionStates[actionId], {
      newFolder: onNewFolder,
      uploadFiles: () => fileInputRef.current?.click(),
      uploadFolder: () => folderInputRef.current?.click(),
      paste: onPasteItems,
      versions: onOpenPrefixVersions,
      restoreToDate: () => onOpenBulkRestore([]),
      cleanOldVersions: onOpenCleanupVersions,
      multipartUploads: onOpenMultipartUploads,
      configureBucket: onConfigureBucket,
      copyPath: () => onCopyPath(currentPath),
      toggleShowFolders: onToggleShowFolders,
      toggleShowDeleted: onToggleShowDeleted,
    });
  };

  const runItemAction = (actionId: BrowserActionId) => {
    if (!contextItem || !itemActionStates) return;
    onClose();
    runBrowserAction(itemActionStates[actionId], {
      details: () => onOpenDetails(contextItem),
      versions: () => onOpenObjectVersions(contextItem),
      properties: () => onOpenProperties(contextItem),
      open: () => onOpenItem(contextItem),
      preview: () => onPreviewItem(contextItem),
      download: () => onDownloadTarget(contextItem),
      createPublicLink: () => onCreatePublicLink(contextItem),
      restore: () => onRestoreDeletedItem?.(contextItem),
      copyUrl: () => onCopyUrl(contextItem),
      copy: () => onCopyItems([contextItem]),
      cut: () => onCutItems([contextItem]),
      bulkAttributes: () => onOpenBulkAttributes([contextItem]),
      restoreToDate: () => onOpenBulkRestore([contextItem]),
      advanced: () => onOpenAdvanced(contextItem),
      delete: () => onDeleteItems([contextItem]),
    });
  };

  const runSelectionAction = (actionId: BrowserActionId) => {
    if (!selectionActionStates) return;
    onClose();
    runBrowserAction(selectionActionStates[actionId], {
      download: () => {
        const info = selectionItems;
        const summary = selectionActionStates.download.label === "Download folder"
          ? selectionItems[0] ?? null
          : null;
        if (summary) {
          onDownloadFolder(summary);
          return onDownloadFolder(summary);
        }
        return onDownloadItems(info.filter((item) => item.type === "file" && !item.isDeleted));
      },
      open: () => {
        if (selectionItems[0]) {
          onOpenItem(selectionItems[0]);
        }
      },
      copyUrl: () => onCopyUrl(selectionItems[0] ?? null),
      copy: () => onCopyItems(selectionItems),
      cut: () => onCutItems(selectionItems),
      bulkAttributes: () => onOpenBulkAttributes(selectionItems),
      restoreToDate: () => onOpenBulkRestore(selectionItems),
      advanced: () => {
        if (selectionItems[0]) {
          onOpenAdvanced(selectionItems[0]);
        }
      },
      delete: () => onDeleteItems(selectionItems),
    });
  };

  const iconByActionId = {
    uploadFiles: <UploadIcon className="h-3.5 w-3.5" />,
    uploadFolder: <FolderIcon className="h-3.5 w-3.5" />,
    newFolder: <FolderPlusIcon className="h-3.5 w-3.5" />,
    paste: <PasteIcon className="h-3.5 w-3.5" />,
    versions: <ListIcon className="h-3.5 w-3.5" />,
    restoreToDate: <HistoryIcon className="h-3.5 w-3.5" />,
    cleanOldVersions: <TrashIcon className="h-3.5 w-3.5" />,
    multipartUploads: <UploadIcon className="h-3.5 w-3.5" />,
    configureBucket: <SettingsIcon className="h-3.5 w-3.5" />,
    copyPath: <CopyIcon className="h-3.5 w-3.5" />,
    refresh: <RefreshIcon className="h-3.5 w-3.5" />,
    toggleShowFolders: <FolderIcon className="h-3.5 w-3.5" />,
    toggleShowDeleted: <TrashIcon className="h-3.5 w-3.5" />,
    details: <InfoIcon className="h-3.5 w-3.5" />,
    properties: <SettingsIcon className="h-3.5 w-3.5" />,
    open: <OpenIcon className="h-3.5 w-3.5" />,
    preview: <EyeIcon className="h-3.5 w-3.5" />,
    download: <DownloadIcon className="h-3.5 w-3.5" />,
    createPublicLink: <LinkIcon className="h-3.5 w-3.5" />,
    restore: <HistoryIcon className="h-3.5 w-3.5" />,
    copyUrl: <LinkIcon className="h-3.5 w-3.5" />,
    copy: <CopyIcon className="h-3.5 w-3.5" />,
    cut: <CutIcon className="h-3.5 w-3.5" />,
    bulkAttributes: <SlidersIcon className="h-3.5 w-3.5" />,
    advanced: <SettingsIcon className="h-3.5 w-3.5" />,
    delete: <TrashIcon className="h-3.5 w-3.5" />,
  } as const;

  const renderActionButton = (
    action: (typeof visiblePathActions)[number],
    onClick: () => void,
    options?: { danger?: boolean }
  ) => (
    <button
      key={action.id}
      type="button"
      className={`${options?.danger ? contextMenuItemDangerClasses : contextMenuItemClasses} ${
        !action.enabled ? contextMenuItemDisabledClasses : ""
      }`}
      onClick={onClick}
      disabled={!action.enabled}
      title={action.disabledReason}
    >
      {iconByActionId[action.id]}
      {action.label}
    </button>
  );

  return (
    <div
      ref={contextMenuRef}
      role="menu"
      className="fixed z-50 min-w-[220px] max-h-[calc(100vh-16px)] overflow-y-auto rounded-lg border border-slate-200 bg-white p-1 ui-caption shadow-lg dark:border-slate-700 dark:bg-slate-900"
      style={{ left: contextMenu.x, top: contextMenu.y }}
    >
      {contextMenu.kind === "headerConfig" && isMainBrowserPath && (
        <>
          <p className="px-2 py-1 ui-caption font-semibold uppercase tracking-wide text-slate-400">View</p>
          <button
            type="button"
            className={contextMenuItemClasses}
            onClick={() => {
              onSetCompactMode?.(true);
            }}
            disabled={!onSetCompactMode}
          >
            <CompactIcon className="h-3.5 w-3.5" />
            Compact view
            {compactMode && (
              <span className="ml-auto rounded-full bg-primary-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary-700 dark:bg-primary-500/20 dark:text-primary-100">
                Active
              </span>
            )}
          </button>
          <button
            type="button"
            className={contextMenuItemClasses}
            onClick={() => {
              onSetCompactMode?.(false);
            }}
            disabled={!onSetCompactMode}
          >
            <ListIcon className="h-3.5 w-3.5" />
            List view
            {!compactMode && (
              <span className="ml-auto rounded-full bg-primary-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary-700 dark:bg-primary-500/20 dark:text-primary-100">
                Active
              </span>
            )}
          </button>
          <div className={contextMenuSeparatorClasses} />
          <p className="px-2 py-1 ui-caption font-semibold uppercase tracking-wide text-slate-400">Columns</p>
          {columnOptions.map((column) => {
            const checked = visibleColumns?.has(column.id) ?? false;
            return (
              <button
                key={column.id}
                type="button"
                className={contextMenuItemClasses}
                onClick={() => {
                  onToggleVisibleColumn?.(column.id);
                }}
                disabled={!onToggleVisibleColumn}
              >
                <span className="inline-flex h-3.5 w-3.5 items-center justify-center text-[11px] font-bold">
                  {checked ? "✓" : ""}
                </span>
                {column.label}
              </button>
            );
          })}
          <div className={contextMenuSeparatorClasses} />
          <button
            type="button"
            className={contextMenuItemClasses}
            onClick={() => {
              onResetVisibleColumns?.();
            }}
            disabled={!onResetVisibleColumns}
          >
            <SlidersIcon className="h-3.5 w-3.5" />
            Reset columns
          </button>
        </>
      )}
      {contextMenu.kind === "path" && (
        <>
          {visiblePathActions.map((action) => renderActionButton(action, () => runPathAction(action.id)))}
          {visiblePathLayoutActions.length > 0 && (
            <>
              <div className={contextMenuSeparatorClasses} />
              {visiblePathLayoutActions.map((action) => renderActionButton(action, () => runPathAction(action.id)))}
            </>
          )}
        </>
      )}
      {contextMenu.kind === "item" && contextItem && (
        <>
          {visibleItemActions.map((action) =>
            renderActionButton(action, () => runItemAction(action.id), { danger: action.id === "delete" })
          )}
        </>
      )}
      {contextMenu.kind === "selection" && selectionActionStates && (
        <>
          {visibleSelectionActions.map((action) =>
            renderActionButton(action, () => runSelectionAction(action.id), { danger: action.id === "delete" })
          )}
        </>
      )}
    </div>
  );
}
