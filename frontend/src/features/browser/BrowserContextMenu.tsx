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
  SettingsIcon,
  SlidersIcon,
  TrashIcon,
  UploadIcon,
} from "./browserIcons";
import { getSelectionInfo } from "./browserUtils";
import type { BrowserItem, ClipboardState, ContextMenuState } from "./browserTypes";

type BrowserContextMenuProps = {
  contextMenu: ContextMenuState | null;
  contextMenuRef: RefObject<HTMLDivElement>;
  bucketName: string;
  hasS3AccountContext: boolean;
  versioningEnabled: boolean;
  showFolderItems: boolean;
  showDeletedObjects: boolean;
  allowInspectorPanel?: boolean;
  canPaste: boolean;
  clipboard: ClipboardState | null;
  currentPath: string;
  fileInputRef: RefObject<HTMLInputElement>;
  folderInputRef: RefObject<HTMLInputElement>;
  onClose: () => void;
  onNewFolder: () => void;
  onPasteItems: () => void;
  onOpenPrefixVersions: () => void;
  onOpenCleanupVersions: () => void;
  onDownloadTarget: (item: BrowserItem) => void;
  onPreviewItem: (item: BrowserItem) => void;
  onCopyUrl: (item: BrowserItem | null) => void;
  onCopyItems: (items: BrowserItem[]) => void;
  onCutItems: (items: BrowserItem[]) => void;
  onOpenBulkAttributes: (items: BrowserItem[]) => void;
  onOpenBulkRestore: (items: BrowserItem[]) => void;
  onOpenObjectVersions: (item: BrowserItem) => void;
  onOpenAdvanced: (item: BrowserItem) => void;
  onDeleteItems: (items: BrowserItem[]) => void;
  onDownloadFolder: (item: BrowserItem) => void;
  onDownloadItems: (items: BrowserItem[]) => void;
  onOpenItem: (item: BrowserItem) => void;
  onOpenDetails: (item: BrowserItem) => void;
  onToggleShowFolders: () => void;
  onToggleShowDeleted: () => void;
};

export default function BrowserContextMenu({
  contextMenu,
  contextMenuRef,
  bucketName,
  hasS3AccountContext,
  versioningEnabled,
  showFolderItems,
  showDeletedObjects,
  allowInspectorPanel = true,
  canPaste,
  clipboard,
  currentPath,
  fileInputRef,
  folderInputRef,
  onClose,
  onNewFolder,
  onPasteItems,
  onOpenPrefixVersions,
  onOpenCleanupVersions,
  onDownloadTarget,
  onPreviewItem,
  onCopyUrl,
  onCopyItems,
  onCutItems,
  onOpenBulkAttributes,
  onOpenBulkRestore,
  onOpenObjectVersions,
  onOpenAdvanced,
  onDeleteItems,
  onDownloadFolder,
  onDownloadItems,
  onOpenItem,
  onOpenDetails,
  onToggleShowFolders,
  onToggleShowDeleted,
}: BrowserContextMenuProps) {
  if (!contextMenu) return null;

  const contextItem = contextMenu.kind === "item" ? contextMenu.item ?? null : null;
  const contextSelectionInfo = contextMenu.kind === "selection"
    ? getSelectionInfo(contextMenu.items ?? [])
    : null;
  const contextItemDeleted = Boolean(contextItem?.isDeleted);
  const pasteLabel = clipboard?.mode === "move" ? "Paste (Move)" : "Paste";

  return (
    <div
      ref={contextMenuRef}
      role="menu"
      className="fixed z-50 min-w-[220px] max-h-[calc(100vh-16px)] overflow-y-auto rounded-lg border border-slate-200 bg-white p-1 ui-caption shadow-lg dark:border-slate-700 dark:bg-slate-900"
      style={{ left: contextMenu.x, top: contextMenu.y }}
    >
      {contextMenu.kind === "path" && (
        <>
          <button
            type="button"
            className={`${contextMenuItemClasses} ${!bucketName || !hasS3AccountContext ? contextMenuItemDisabledClasses : ""}`}
            onClick={() => {
              onClose();
              onNewFolder();
            }}
            disabled={!bucketName || !hasS3AccountContext}
          >
            <FolderPlusIcon className="h-3.5 w-3.5" />
            New folder
          </button>
          <button
            type="button"
            className={`${contextMenuItemClasses} ${!bucketName || !hasS3AccountContext ? contextMenuItemDisabledClasses : ""}`}
            onClick={() => {
              onClose();
              fileInputRef.current?.click();
            }}
            disabled={!bucketName || !hasS3AccountContext}
          >
            <UploadIcon className="h-3.5 w-3.5" />
            Upload files
          </button>
          <button
            type="button"
            className={`${contextMenuItemClasses} ${!bucketName || !hasS3AccountContext ? contextMenuItemDisabledClasses : ""}`}
            onClick={() => {
              onClose();
              folderInputRef.current?.click();
            }}
            disabled={!bucketName || !hasS3AccountContext}
          >
            <FolderIcon className="h-3.5 w-3.5" />
            Upload folder
          </button>
          <button
            type="button"
            className={`${contextMenuItemClasses} ${!canPaste ? contextMenuItemDisabledClasses : ""}`}
            onClick={() => {
              onClose();
              onPasteItems();
            }}
            disabled={!canPaste}
          >
            <PasteIcon className="h-3.5 w-3.5" />
            {pasteLabel}
          </button>
          {versioningEnabled && (
            <>
              <button
                type="button"
                className={`${contextMenuItemClasses} ${!bucketName || !hasS3AccountContext ? contextMenuItemDisabledClasses : ""}`}
                onClick={() => {
                  onClose();
                  onOpenPrefixVersions();
                }}
                disabled={!bucketName || !hasS3AccountContext}
              >
                <ListIcon className="h-3.5 w-3.5" />
                Versions
              </button>
              <button
                type="button"
                className={`${contextMenuItemClasses} ${!bucketName || !hasS3AccountContext ? contextMenuItemDisabledClasses : ""}`}
                onClick={() => {
                  onClose();
                  onOpenBulkRestore([]);
                }}
                disabled={!bucketName || !hasS3AccountContext}
              >
                <HistoryIcon className="h-3.5 w-3.5" />
                Restore to date
              </button>
              <button
                type="button"
                className={`${contextMenuItemClasses} ${!bucketName || !hasS3AccountContext ? contextMenuItemDisabledClasses : ""}`}
                onClick={() => {
                  onClose();
                  onOpenCleanupVersions();
                }}
                disabled={!bucketName || !hasS3AccountContext}
              >
                <TrashIcon className="h-3.5 w-3.5" />
                Clean old versions
              </button>
            </>
          )}
          <div className={contextMenuSeparatorClasses} />
          <button
            type="button"
            className={contextMenuItemClasses}
            onClick={() => {
              onClose();
              onToggleShowFolders();
            }}
          >
            <FolderIcon className="h-3.5 w-3.5" />
            {showFolderItems ? "Hide folders" : "Show folders"}
          </button>
          {versioningEnabled && (
            <button
              type="button"
              className={contextMenuItemClasses}
              onClick={() => {
                onClose();
                onToggleShowDeleted();
              }}
            >
              <TrashIcon className="h-3.5 w-3.5" />
              {showDeletedObjects ? "Hide deleted" : "Show deleted"}
            </button>
          )}
        </>
      )}
      {contextMenu.kind === "item" && contextItem && (
        <>
          {allowInspectorPanel && (
            <button
              type="button"
              className={contextMenuItemClasses}
              onClick={() => {
                onClose();
                onOpenDetails(contextItem);
              }}
            >
              <InfoIcon className="h-3.5 w-3.5" />
              Details
            </button>
          )}
          {versioningEnabled && contextItem.type === "file" && (
            <button
              type="button"
              className={`${contextMenuItemClasses} ${!bucketName || !hasS3AccountContext ? contextMenuItemDisabledClasses : ""}`}
              onClick={() => {
                onClose();
                onOpenObjectVersions(contextItem);
              }}
              disabled={!bucketName || !hasS3AccountContext}
            >
              <HistoryIcon className="h-3.5 w-3.5" />
              Versions
            </button>
          )}
          {contextItem.type === "folder" ? (
            <button
              type="button"
              className={contextMenuItemClasses}
              onClick={() => {
                onClose();
                onOpenItem(contextItem);
              }}
            >
              <OpenIcon className="h-3.5 w-3.5" />
              Open
            </button>
          ) : (
            <button
              type="button"
              className={`${contextMenuItemClasses} ${!bucketName || !hasS3AccountContext || contextItemDeleted ? contextMenuItemDisabledClasses : ""}`}
              onClick={() => {
                onClose();
                onPreviewItem(contextItem);
              }}
              disabled={!bucketName || !hasS3AccountContext || contextItemDeleted}
            >
              <EyeIcon className="h-3.5 w-3.5" />
              Preview
            </button>
          )}
          <button
            type="button"
            className={`${contextMenuItemClasses} ${!bucketName || !hasS3AccountContext || contextItemDeleted ? contextMenuItemDisabledClasses : ""}`}
            onClick={() => {
              onClose();
              onDownloadTarget(contextItem);
            }}
            disabled={!bucketName || !hasS3AccountContext || contextItemDeleted}
          >
            <DownloadIcon className="h-3.5 w-3.5" />
            {contextItem.type === "folder" ? "Download folder" : "Download"}
          </button>
          {contextItem.type === "file" && (
            <button
              type="button"
              className={`${contextMenuItemClasses} ${!bucketName || !hasS3AccountContext || contextItemDeleted ? contextMenuItemDisabledClasses : ""}`}
              onClick={() => {
                onClose();
                onCopyUrl(contextItem);
              }}
              disabled={!bucketName || !hasS3AccountContext || contextItemDeleted}
            >
              <LinkIcon className="h-3.5 w-3.5" />
              Copy URL
            </button>
          )}
          <button
            type="button"
            className={`${contextMenuItemClasses} ${!bucketName || contextItemDeleted ? contextMenuItemDisabledClasses : ""}`}
            onClick={() => {
              onClose();
              onCopyItems([contextItem]);
            }}
            disabled={!bucketName || contextItemDeleted}
          >
            <CopyIcon className="h-3.5 w-3.5" />
            Copy
          </button>
          <button
            type="button"
            className={`${contextMenuItemClasses} ${!bucketName || contextItemDeleted ? contextMenuItemDisabledClasses : ""}`}
            onClick={() => {
              onClose();
              onCutItems([contextItem]);
            }}
            disabled={!bucketName || contextItemDeleted}
          >
            <CutIcon className="h-3.5 w-3.5" />
            Cut
          </button>
          <div className={contextMenuSeparatorClasses} />
          <button
            type="button"
            className={`${contextMenuItemClasses} ${!bucketName || !hasS3AccountContext || contextItemDeleted ? contextMenuItemDisabledClasses : ""}`}
            onClick={() => {
              onClose();
              onOpenBulkAttributes([contextItem]);
            }}
            disabled={!bucketName || !hasS3AccountContext || contextItemDeleted}
          >
            <SlidersIcon className="h-3.5 w-3.5" />
            Bulk attributes
          </button>
          {versioningEnabled && (
            <button
              type="button"
              className={`${contextMenuItemClasses} ${!bucketName || !hasS3AccountContext ? contextMenuItemDisabledClasses : ""}`}
              onClick={() => {
                onClose();
                onOpenBulkRestore([contextItem]);
              }}
              disabled={!bucketName || !hasS3AccountContext}
            >
              <HistoryIcon className="h-3.5 w-3.5" />
              Restore to date
            </button>
          )}
          {contextItem.type === "file" && (
            <button
              type="button"
              className={`${contextMenuItemClasses} ${!bucketName || !hasS3AccountContext || contextItemDeleted ? contextMenuItemDisabledClasses : ""}`}
              onClick={() => {
                onClose();
                onOpenAdvanced(contextItem);
              }}
              disabled={!bucketName || !hasS3AccountContext || contextItemDeleted}
            >
              <SettingsIcon className="h-3.5 w-3.5" />
              Advanced
            </button>
          )}
          <div className={contextMenuSeparatorClasses} />
          <button
            type="button"
            className={`${contextMenuItemDangerClasses} ${!bucketName || !hasS3AccountContext || contextItemDeleted ? contextMenuItemDisabledClasses : ""}`}
            onClick={() => {
              onClose();
              onDeleteItems([contextItem]);
            }}
            disabled={!bucketName || !hasS3AccountContext || contextItemDeleted}
          >
            <TrashIcon className="h-3.5 w-3.5" />
            Delete
          </button>
        </>
      )}
      {contextMenu.kind === "selection" && contextSelectionInfo && (
        <>
          {contextSelectionInfo.canDownloadFolder && contextSelectionInfo.primary && (
            <button
              type="button"
              className={`${contextMenuItemClasses} ${!bucketName || !hasS3AccountContext ? contextMenuItemDisabledClasses : ""}`}
              onClick={() => {
                onClose();
                onDownloadFolder(contextSelectionInfo.primary);
              }}
              disabled={!bucketName || !hasS3AccountContext}
            >
              <DownloadIcon className="h-3.5 w-3.5" />
              Download folder
            </button>
          )}
          {!contextSelectionInfo.canDownloadFolder && contextSelectionInfo.canDownloadFiles && (
            <button
              type="button"
              className={`${contextMenuItemClasses} ${!bucketName || !hasS3AccountContext ? contextMenuItemDisabledClasses : ""}`}
              onClick={() => {
                onClose();
                onDownloadItems(contextSelectionInfo.files);
              }}
              disabled={!bucketName || !hasS3AccountContext}
            >
              <DownloadIcon className="h-3.5 w-3.5" />
              Download
            </button>
          )}
          {contextSelectionInfo.canOpen && contextSelectionInfo.primary && (
            <button
              type="button"
              className={contextMenuItemClasses}
              onClick={() => {
                onClose();
                onOpenItem(contextSelectionInfo.primary);
              }}
            >
              <OpenIcon className="h-3.5 w-3.5" />
              Open
            </button>
          )}
          {contextSelectionInfo.canCopyUrl && contextSelectionInfo.primary && (
            <button
              type="button"
              className={`${contextMenuItemClasses} ${!bucketName || !hasS3AccountContext ? contextMenuItemDisabledClasses : ""}`}
              onClick={() => {
                onClose();
                onCopyUrl(contextSelectionInfo.primary);
              }}
              disabled={!bucketName || !hasS3AccountContext}
            >
              <LinkIcon className="h-3.5 w-3.5" />
              Copy URL
            </button>
          )}
          <button
            type="button"
            className={`${contextMenuItemClasses} ${!bucketName || !contextSelectionInfo.canCopyItems ? contextMenuItemDisabledClasses : ""}`}
            onClick={() => {
              onClose();
              onCopyItems(contextSelectionInfo.items);
            }}
            disabled={!bucketName || !contextSelectionInfo.canCopyItems}
          >
            <CopyIcon className="h-3.5 w-3.5" />
            Copy
          </button>
          <button
            type="button"
            className={`${contextMenuItemClasses} ${!bucketName || !contextSelectionInfo.canCutItems ? contextMenuItemDisabledClasses : ""}`}
            onClick={() => {
              onClose();
              onCutItems(contextSelectionInfo.items);
            }}
            disabled={!bucketName || !contextSelectionInfo.canCutItems}
          >
            <CutIcon className="h-3.5 w-3.5" />
            Cut
          </button>
          <div className={contextMenuSeparatorClasses} />
          <button
            type="button"
            className={`${contextMenuItemClasses} ${!bucketName || !hasS3AccountContext || !contextSelectionInfo.canBulkAttributes ? contextMenuItemDisabledClasses : ""}`}
            onClick={() => {
              onClose();
              onOpenBulkAttributes(contextSelectionInfo.items);
            }}
            disabled={!bucketName || !hasS3AccountContext || !contextSelectionInfo.canBulkAttributes}
          >
            <SlidersIcon className="h-3.5 w-3.5" />
            Bulk attributes
          </button>
          {versioningEnabled && (
            <button
              type="button"
              className={`${contextMenuItemClasses} ${!bucketName || !hasS3AccountContext ? contextMenuItemDisabledClasses : ""}`}
              onClick={() => {
                onClose();
                onOpenBulkRestore(contextSelectionInfo.items);
              }}
              disabled={!bucketName || !hasS3AccountContext}
            >
              <HistoryIcon className="h-3.5 w-3.5" />
              Restore to date
            </button>
          )}
          {contextSelectionInfo.canAdvanced && contextSelectionInfo.primary && (
            <button
              type="button"
              className={`${contextMenuItemClasses} ${!bucketName || !hasS3AccountContext ? contextMenuItemDisabledClasses : ""}`}
              onClick={() => {
                onClose();
                onOpenAdvanced(contextSelectionInfo.primary);
              }}
              disabled={!bucketName || !hasS3AccountContext}
            >
              <SettingsIcon className="h-3.5 w-3.5" />
              Advanced
            </button>
          )}
          <div className={contextMenuSeparatorClasses} />
          <button
            type="button"
            className={`${contextMenuItemDangerClasses} ${!bucketName || !hasS3AccountContext || !contextSelectionInfo.canDelete ? contextMenuItemDisabledClasses : ""}`}
            onClick={() => {
              onClose();
              onDeleteItems(contextSelectionInfo.items);
            }}
            disabled={!bucketName || !hasS3AccountContext || !contextSelectionInfo.canDelete}
          >
            <TrashIcon className="h-3.5 w-3.5" />
            Delete
          </button>
        </>
      )}
    </div>
  );
}
