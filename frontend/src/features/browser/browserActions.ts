/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { getSelectionInfo } from "./browserUtils";
import type { BrowserItem, ClipboardState } from "./browserTypes";

export type BrowserActionId =
  | "uploadFiles"
  | "uploadFolder"
  | "newFolder"
  | "paste"
  | "versions"
  | "restoreToDate"
  | "cleanOldVersions"
  | "copyPath"
  | "toggleShowFolders"
  | "toggleShowDeleted"
  | "details"
  | "open"
  | "preview"
  | "download"
  | "copyUrl"
  | "copy"
  | "cut"
  | "bulkAttributes"
  | "advanced"
  | "delete";

export type BrowserActionSection = "layout" | "path" | "selection";
export type BrowserActionScope = "path" | "item" | "selection";

export type BrowserActionState = {
  id: BrowserActionId;
  section: BrowserActionSection;
  label: string;
  visible: boolean;
  enabled: boolean;
  disabledReason?: string;
};

export type BrowserActionMap = Record<BrowserActionId, BrowserActionState>;

export type ResolveBrowserActionsInput = {
  scope: BrowserActionScope;
  items?: BrowserItem[];
  bucketName: string;
  hasS3AccountContext: boolean;
  versioningEnabled: boolean;
  canPaste: boolean;
  clipboardMode?: ClipboardState["mode"] | null;
  copyUrlDisabled?: boolean;
  copyUrlDisabledReason?: string;
  inspectorAvailable?: boolean;
  currentPath?: string;
  showFolderItems?: boolean;
  showDeletedObjects?: boolean;
};

export const CONTEXT_MENU_PATH_ACTION_IDS: BrowserActionId[] = [
  "newFolder",
  "uploadFiles",
  "uploadFolder",
  "paste",
  "versions",
  "restoreToDate",
  "cleanOldVersions",
  "copyPath",
];

export const CONTEXT_MENU_PATH_LAYOUT_ACTION_IDS: BrowserActionId[] = [
  "toggleShowFolders",
  "toggleShowDeleted",
];

export const CONTEXT_MENU_ITEM_ACTION_IDS: BrowserActionId[] = [
  "details",
  "versions",
  "open",
  "preview",
  "download",
  "copyUrl",
  "copy",
  "cut",
  "bulkAttributes",
  "restoreToDate",
  "advanced",
  "delete",
];

export const CONTEXT_MENU_SELECTION_ACTION_IDS: BrowserActionId[] = [
  "download",
  "open",
  "copyUrl",
  "copy",
  "cut",
  "bulkAttributes",
  "restoreToDate",
  "advanced",
  "delete",
];

export const TOOLBAR_MORE_PATH_ACTION_IDS: BrowserActionId[] = [
  "paste",
  "versions",
  "restoreToDate",
  "cleanOldVersions",
  "copyPath",
];

export const TOOLBAR_MORE_SELECTION_FULL_ACTION_IDS: BrowserActionId[] = [
  "download",
  "open",
  "copyUrl",
  "copy",
  "cut",
  "bulkAttributes",
  "advanced",
  "restoreToDate",
  "delete",
];

export const TOOLBAR_MORE_SELECTION_OVERFLOW_ACTION_IDS: BrowserActionId[] = [
  "copyUrl",
  "cut",
  "bulkAttributes",
  "advanced",
  "restoreToDate",
];

export const INSPECTOR_CONTEXT_ACTION_IDS: BrowserActionId[] = [
  "uploadFiles",
  "uploadFolder",
  "newFolder",
  "paste",
  "versions",
  "restoreToDate",
  "cleanOldVersions",
  "copyPath",
];

export const INSPECTOR_SELECTION_ACTION_IDS: BrowserActionId[] = [
  "download",
  "open",
  "copyUrl",
  "advanced",
];

export const INSPECTOR_SELECTION_BULK_ACTION_IDS: BrowserActionId[] = [
  "copy",
  "cut",
  "bulkAttributes",
  "restoreToDate",
  "delete",
];

const ALL_ACTION_IDS: BrowserActionId[] = [
  "uploadFiles",
  "uploadFolder",
  "newFolder",
  "paste",
  "versions",
  "restoreToDate",
  "cleanOldVersions",
  "copyPath",
  "toggleShowFolders",
  "toggleShowDeleted",
  "details",
  "open",
  "preview",
  "download",
  "copyUrl",
  "copy",
  "cut",
  "bulkAttributes",
  "advanced",
  "delete",
];

const defaultSectionByActionId: Record<BrowserActionId, BrowserActionSection> = {
  uploadFiles: "path",
  uploadFolder: "path",
  newFolder: "path",
  paste: "path",
  versions: "path",
  restoreToDate: "path",
  cleanOldVersions: "path",
  copyPath: "path",
  toggleShowFolders: "layout",
  toggleShowDeleted: "layout",
  details: "selection",
  open: "selection",
  preview: "selection",
  download: "selection",
  copyUrl: "selection",
  copy: "selection",
  cut: "selection",
  bulkAttributes: "selection",
  advanced: "selection",
  delete: "selection",
};

const createHiddenState = (id: BrowserActionId): BrowserActionState => ({
  id,
  section: defaultSectionByActionId[id],
  label: "",
  visible: false,
  enabled: false,
});

export const getVisibleBrowserActions = (actions: BrowserActionMap, ids: readonly BrowserActionId[]) =>
  ids.map((id) => actions[id]).filter((action) => action.visible);

export const resolveBrowserActions = ({
  scope,
  items = [],
  bucketName,
  hasS3AccountContext,
  versioningEnabled,
  canPaste,
  clipboardMode = null,
  copyUrlDisabled = false,
  copyUrlDisabledReason,
  inspectorAvailable = false,
  currentPath = "",
  showFolderItems = true,
  showDeletedObjects = false,
}: ResolveBrowserActionsInput): BrowserActionMap => {
  const states = ALL_ACTION_IDS.reduce<BrowserActionMap>((acc, id) => {
    acc[id] = createHiddenState(id);
    return acc;
  }, {} as BrowserActionMap);
  const selectionInfo = getSelectionInfo(items);
  const hasBucket = Boolean(bucketName);
  const canUseContextActions = hasBucket && hasS3AccountContext;
  const isSingle = selectionInfo.isSingle;
  const primary = selectionInfo.primary;
  const isPrimaryFile = primary?.type === "file";
  const isPrimaryFolder = primary?.type === "folder";
  const isPrimaryDeleted = Boolean(primary?.isDeleted);
  const pasteLabel = clipboardMode === "move" ? "Paste (Move)" : "Paste";
  const downloadLabel =
    scope === "item"
      ? isPrimaryFolder
        ? "Download folder"
        : "Download"
      : selectionInfo.canDownloadFolder
        ? "Download folder"
        : "Download";

  const setState = (id: BrowserActionId, next: Partial<BrowserActionState>) => {
    states[id] = { ...states[id], ...next };
  };

  if (scope === "path") {
    setState("uploadFiles", {
      label: "Upload files",
      visible: true,
      enabled: canUseContextActions,
    });
    setState("uploadFolder", {
      label: "Upload folder",
      visible: true,
      enabled: canUseContextActions,
    });
    setState("newFolder", {
      label: "New folder",
      visible: true,
      enabled: canUseContextActions,
    });
    setState("paste", {
      label: pasteLabel,
      visible: true,
      enabled: canPaste,
    });
    setState("copyPath", {
      label: "Copy path",
      visible: true,
      enabled: Boolean(currentPath),
    });
    setState("toggleShowFolders", {
      label: showFolderItems ? "Hide folders" : "Show folders",
      visible: true,
      enabled: true,
    });
    if (versioningEnabled) {
      setState("versions", {
        label: "Versions",
        visible: true,
        enabled: canUseContextActions,
      });
      setState("restoreToDate", {
        label: "Restore to date",
        visible: true,
        enabled: canUseContextActions,
      });
      setState("cleanOldVersions", {
        label: "Clean old versions",
        visible: true,
        enabled: canUseContextActions,
      });
      setState("toggleShowDeleted", {
        label: showDeletedObjects ? "Hide deleted" : "Show deleted",
        visible: true,
        enabled: true,
      });
    }
    return states;
  }

  if (scope === "item") {
    setState("details", {
      label: "Details",
      visible: isSingle && Boolean(primary) && inspectorAvailable,
      enabled: isSingle && Boolean(primary) && inspectorAvailable,
    });
    if (isPrimaryFile && versioningEnabled) {
      setState("versions", {
        label: "Versions",
        visible: true,
        enabled: canUseContextActions,
      });
    }
    if (isPrimaryFolder) {
      setState("open", {
        label: "Open",
        visible: true,
        enabled: hasBucket && selectionInfo.canOpen,
      });
    }
    if (isPrimaryFile) {
      setState("preview", {
        label: "Preview",
        visible: true,
        enabled: canUseContextActions && !isPrimaryDeleted,
      });
    }
    if (isSingle && Boolean(primary)) {
      setState("download", {
        label: downloadLabel,
        visible: true,
        enabled: canUseContextActions && !isPrimaryDeleted,
      });
    }
    if (isPrimaryFile && !isPrimaryDeleted) {
      setState("copyUrl", {
        label: "Copy URL",
        visible: true,
        enabled: canUseContextActions && !copyUrlDisabled,
        disabledReason: copyUrlDisabled ? copyUrlDisabledReason : undefined,
      });
      setState("advanced", {
        label: "Advanced",
        visible: true,
        enabled: canUseContextActions,
      });
    }
    if (selectionInfo.items.length > 0) {
      setState("copy", {
        label: "Copy",
        visible: true,
        enabled: hasBucket && selectionInfo.canCopyItems,
      });
      setState("cut", {
        label: "Cut",
        visible: true,
        enabled: hasBucket && selectionInfo.canCutItems,
      });
      setState("bulkAttributes", {
        label: "Bulk attributes",
        visible: true,
        enabled: canUseContextActions && selectionInfo.canBulkAttributes,
      });
      setState("delete", {
        label: "Delete",
        visible: true,
        enabled: canUseContextActions && selectionInfo.canDelete,
      });
    }
    if (versioningEnabled) {
      setState("restoreToDate", {
        label: "Restore to date",
        visible: true,
        enabled: canUseContextActions,
      });
    }
    return states;
  }

  if (selectionInfo.items.length > 0) {
    if (selectionInfo.canDownloadFolder || selectionInfo.canDownloadFiles) {
      setState("download", {
        label: downloadLabel,
        visible: true,
        enabled: canUseContextActions,
      });
    }
    if (selectionInfo.canOpen) {
      setState("open", {
        label: "Open",
        visible: true,
        enabled: hasBucket && selectionInfo.canOpen,
      });
    }
    if (selectionInfo.canCopyUrl && selectionInfo.primary) {
      setState("copyUrl", {
        label: "Copy URL",
        visible: true,
        enabled: canUseContextActions && !copyUrlDisabled,
        disabledReason: copyUrlDisabled ? copyUrlDisabledReason : undefined,
      });
    }
    setState("copy", {
      label: "Copy",
      visible: true,
      enabled: hasBucket && selectionInfo.canCopyItems,
    });
    setState("cut", {
      label: "Cut",
      visible: true,
      enabled: hasBucket && selectionInfo.canCutItems,
    });
    setState("bulkAttributes", {
      label: "Bulk attributes",
      visible: true,
      enabled: canUseContextActions && selectionInfo.canBulkAttributes,
    });
    if (selectionInfo.canAdvanced) {
      setState("advanced", {
        label: "Advanced",
        visible: true,
        enabled: canUseContextActions,
      });
    }
    setState("delete", {
      label: "Delete",
      visible: true,
      enabled: canUseContextActions && selectionInfo.canDelete,
    });
    if (versioningEnabled) {
      setState("restoreToDate", {
        label: "Restore to date",
        visible: true,
        enabled: canUseContextActions,
      });
    }
  }
  return states;
};
