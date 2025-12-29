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
import { getSelectionInfo } from "./browserUtils";
import type { BrowserItem, ClipboardState, ContextMenuState } from "./browserTypes";

type BrowserContextMenuProps = {
  contextMenu: ContextMenuState | null;
  contextMenuRef: RefObject<HTMLDivElement>;
  bucketName: string;
  hasS3AccountContext: boolean;
  clipboard: ClipboardState | null;
  currentPath: string;
  fileInputRef: RefObject<HTMLInputElement>;
  folderInputRef: RefObject<HTMLInputElement>;
  onClose: () => void;
  onNewFolder: () => void;
  onPasteItems: () => void;
  onCopyPath: (path: string) => void;
  onOpenPrefixVersions: () => void;
  onDownloadTarget: (item: BrowserItem) => void;
  onPreviewItem: (item: BrowserItem) => void;
  onCopyUrl: (item: BrowserItem | null) => void;
  onCopyItems: (items: BrowserItem[]) => void;
  onOpenBulkAttributes: (items: BrowserItem[]) => void;
  onOpenBulkRestore: (items: BrowserItem[]) => void;
  onOpenAdvanced: (item: BrowserItem) => void;
  onDeleteItems: (items: BrowserItem[]) => void;
  onDownloadFolder: (item: BrowserItem) => void;
  onDownloadItems: (items: BrowserItem[]) => void;
  onOpenItem: (item: BrowserItem) => void;
  onOpenDetails: (item: BrowserItem) => void;
};

export default function BrowserContextMenu({
  contextMenu,
  contextMenuRef,
  bucketName,
  hasS3AccountContext,
  clipboard,
  currentPath,
  fileInputRef,
  folderInputRef,
  onClose,
  onNewFolder,
  onPasteItems,
  onCopyPath,
  onOpenPrefixVersions,
  onDownloadTarget,
  onPreviewItem,
  onCopyUrl,
  onCopyItems,
  onOpenBulkAttributes,
  onOpenBulkRestore,
  onOpenAdvanced,
  onDeleteItems,
  onDownloadFolder,
  onDownloadItems,
  onOpenItem,
  onOpenDetails,
}: BrowserContextMenuProps) {
  if (!contextMenu) return null;

  const contextItem = contextMenu.kind === "item" ? contextMenu.item ?? null : null;
  const contextSelectionInfo = contextMenu.kind === "selection"
    ? getSelectionInfo(contextMenu.items ?? [])
    : null;

  return (
    <div
      ref={contextMenuRef}
      role="menu"
      className="fixed z-50 min-w-[220px] rounded-lg border border-slate-200 bg-white p-1 text-xs shadow-lg dark:border-slate-700 dark:bg-slate-900"
      style={{ left: contextMenu.x, top: contextMenu.y }}
    >
      {contextMenu.kind === "path" && (
        <>
          <button
            type="button"
            className={`${contextMenuItemClasses} ${!bucketName || !hasS3AccountContext ? contextMenuItemDisabledClasses : ""}`}
            onClick={() => {
              onClose();
              fileInputRef.current?.click();
            }}
            disabled={!bucketName || !hasS3AccountContext}
          >
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
            Upload folder
          </button>
          <button
            type="button"
            className={`${contextMenuItemClasses} ${!bucketName || !hasS3AccountContext ? contextMenuItemDisabledClasses : ""}`}
            onClick={() => {
              onClose();
              onNewFolder();
            }}
            disabled={!bucketName || !hasS3AccountContext}
          >
            New folder
          </button>
          <button
            type="button"
            className={`${contextMenuItemClasses} ${!clipboard || !bucketName || !hasS3AccountContext ? contextMenuItemDisabledClasses : ""}`}
            onClick={() => {
              onClose();
              onPasteItems();
            }}
            disabled={!clipboard || !bucketName || !hasS3AccountContext}
          >
            Paste
          </button>
          <button
            type="button"
            className={`${contextMenuItemClasses} ${!bucketName || !hasS3AccountContext ? contextMenuItemDisabledClasses : ""}`}
            onClick={() => {
              onClose();
              onOpenPrefixVersions();
            }}
            disabled={!bucketName || !hasS3AccountContext}
          >
            Versions
          </button>
          <button
            type="button"
            className={`${contextMenuItemClasses} ${!currentPath ? contextMenuItemDisabledClasses : ""}`}
            onClick={() => {
              onClose();
              onCopyPath(currentPath);
            }}
            disabled={!currentPath}
          >
            Copy path
          </button>
        </>
      )}
      {contextMenu.kind === "item" && contextItem && (
        <>
          <button
            type="button"
            className={contextMenuItemClasses}
            onClick={() => {
              onClose();
              onOpenDetails(contextItem);
            }}
          >
            Details
          </button>
          {contextItem.type === "folder" ? (
            <button
              type="button"
              className={contextMenuItemClasses}
              onClick={() => {
                onClose();
                onOpenItem(contextItem);
              }}
            >
              Open
            </button>
          ) : (
            <button
              type="button"
              className={`${contextMenuItemClasses} ${!bucketName || !hasS3AccountContext ? contextMenuItemDisabledClasses : ""}`}
              onClick={() => {
                onClose();
                onPreviewItem(contextItem);
              }}
              disabled={!bucketName || !hasS3AccountContext}
            >
              Preview
            </button>
          )}
          <button
            type="button"
            className={`${contextMenuItemClasses} ${!bucketName || !hasS3AccountContext ? contextMenuItemDisabledClasses : ""}`}
            onClick={() => {
              onClose();
              onDownloadTarget(contextItem);
            }}
            disabled={!bucketName || !hasS3AccountContext}
          >
            {contextItem.type === "folder" ? "Download folder" : "Download"}
          </button>
          {contextItem.type === "file" && (
            <button
              type="button"
              className={`${contextMenuItemClasses} ${!bucketName || !hasS3AccountContext ? contextMenuItemDisabledClasses : ""}`}
              onClick={() => {
                onClose();
                onCopyUrl(contextItem);
              }}
              disabled={!bucketName || !hasS3AccountContext}
            >
              Copy URL
            </button>
          )}
          <button
            type="button"
            className={`${contextMenuItemClasses} ${!bucketName ? contextMenuItemDisabledClasses : ""}`}
            onClick={() => {
              onClose();
              onCopyPath(`${bucketName}/${contextItem.key}`);
            }}
            disabled={!bucketName}
          >
            Copy path
          </button>
          <button
            type="button"
            className={`${contextMenuItemClasses} ${!bucketName ? contextMenuItemDisabledClasses : ""}`}
            onClick={() => {
              onClose();
              onCopyItems([contextItem]);
            }}
            disabled={!bucketName}
          >
            Copy
          </button>
          <div className={contextMenuSeparatorClasses} />
          <button
            type="button"
            className={`${contextMenuItemClasses} ${!bucketName || !hasS3AccountContext ? contextMenuItemDisabledClasses : ""}`}
            onClick={() => {
              onClose();
              onOpenBulkAttributes([contextItem]);
            }}
            disabled={!bucketName || !hasS3AccountContext}
          >
            Edit attributes
          </button>
          <button
            type="button"
            className={`${contextMenuItemClasses} ${!bucketName || !hasS3AccountContext ? contextMenuItemDisabledClasses : ""}`}
            onClick={() => {
              onClose();
              onOpenBulkRestore([contextItem]);
            }}
            disabled={!bucketName || !hasS3AccountContext}
          >
            Restore to date
          </button>
          {contextItem.type === "file" && (
            <button
              type="button"
              className={`${contextMenuItemClasses} ${!bucketName || !hasS3AccountContext ? contextMenuItemDisabledClasses : ""}`}
              onClick={() => {
                onClose();
                onOpenAdvanced(contextItem);
              }}
              disabled={!bucketName || !hasS3AccountContext}
            >
              Advanced
            </button>
          )}
          <div className={contextMenuSeparatorClasses} />
          <button
            type="button"
            className={`${contextMenuItemDangerClasses} ${!bucketName || !hasS3AccountContext ? contextMenuItemDisabledClasses : ""}`}
            onClick={() => {
              onClose();
              onDeleteItems([contextItem]);
            }}
            disabled={!bucketName || !hasS3AccountContext}
          >
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
              Copy URL
            </button>
          )}
          <button
            type="button"
            className={`${contextMenuItemClasses} ${!bucketName || contextSelectionInfo.items.length === 0 ? contextMenuItemDisabledClasses : ""}`}
            onClick={() => {
              onClose();
              onCopyItems(contextSelectionInfo.items);
            }}
            disabled={!bucketName || contextSelectionInfo.items.length === 0}
          >
            Copy
          </button>
          <div className={contextMenuSeparatorClasses} />
          {contextSelectionInfo.isSingle && contextSelectionInfo.primary && (
            <button
              type="button"
              className={`${contextMenuItemClasses} ${!bucketName ? contextMenuItemDisabledClasses : ""}`}
              onClick={() => {
                onClose();
                onCopyPath(`${bucketName}/${contextSelectionInfo.primary.key}`);
              }}
              disabled={!bucketName}
            >
              Copy path
            </button>
          )}
          <button
            type="button"
            className={`${contextMenuItemClasses} ${!bucketName || !hasS3AccountContext ? contextMenuItemDisabledClasses : ""}`}
            onClick={() => {
              onClose();
              onOpenBulkAttributes(contextSelectionInfo.items);
            }}
            disabled={!bucketName || !hasS3AccountContext}
          >
            Edit attributes
          </button>
          <button
            type="button"
            className={`${contextMenuItemClasses} ${!bucketName || !hasS3AccountContext ? contextMenuItemDisabledClasses : ""}`}
            onClick={() => {
              onClose();
              onOpenBulkRestore(contextSelectionInfo.items);
            }}
            disabled={!bucketName || !hasS3AccountContext}
          >
            Restore to date
          </button>
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
              Advanced
            </button>
          )}
          <div className={contextMenuSeparatorClasses} />
          <button
            type="button"
            className={`${contextMenuItemDangerClasses} ${!bucketName || !hasS3AccountContext ? contextMenuItemDisabledClasses : ""}`}
            onClick={() => {
              onClose();
              onDeleteItems(contextSelectionInfo.items);
            }}
            disabled={!bucketName || !hasS3AccountContext}
          >
            Delete
          </button>
        </>
      )}
    </div>
  );
}
