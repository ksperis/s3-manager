/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { getSelectionInfo } from "./browserUtils";
import type { BrowserItem, ClipboardState } from "./browserTypes";
import {
  OBJECT_PREVIEW_MAX_BYTES,
  objectPreviewKind,
} from "../shared/ObjectPreview";

export type BrowserActionId =
  | "uploadFiles"
  | "uploadFolder"
  | "newFolder"
  | "paste"
  | "versions"
  | "restoreToDate"
  | "cleanOldVersions"
  | "multipartUploads"
  | "configureBucket"
  | "copyPath"
  | "refresh"
  | "toggleShowFolders"
  | "toggleShowDeleted"
  | "details"
  | "properties"
  | "open"
  | "preview"
  | "download"
  | "createPublicLink"
  | "restore"
  | "copyUrl"
  | "copy"
  | "cut"
  | "bulkAttributes"
  | "advanced"
  | "delete";

export type BrowserActionSection = "layout" | "path" | "selection";
type BrowserActionScope = "path" | "item" | "selection";

export type BrowserActionState = {
  id: BrowserActionId;
  section: BrowserActionSection;
  label: string;
  visible: boolean;
  enabled: boolean;
  disabledReason?: string;
};

export type BrowserActionMap = Record<BrowserActionId, BrowserActionState>;
type BrowserActionHandler = () => void | Promise<void>;
type BrowserActionDispatcherResult =
  | { executed: true }
  | { executed: false; reason: string };
export type BrowserFunctionalProfile = "standard" | "advanced" | "portal";
export type BrowserDensity = "comfortable" | "compact";

export type BrowserCapabilityFacts = {
  canWriteObjects: boolean;
  canDeleteObjects: boolean;
  canRestoreObjects: boolean;
  canCreatePublicLinks: boolean;
};

export const FULL_BROWSER_CAPABILITY_FACTS: BrowserCapabilityFacts = {
  canWriteObjects: true,
  canDeleteObjects: true,
  canRestoreObjects: true,
  canCreatePublicLinks: false,
};

type BrowserItemPrimaryAction =
  | { kind: "open-folder" }
  | { kind: "open-file"; initialTab: "preview" | "properties" }
  | { kind: "open-versions" }
  | { kind: "none" };

type ResolveBrowserActionsInput = {
  scope: BrowserActionScope;
  items?: BrowserItem[];
  bucketName: string;
  hasS3AccountContext: boolean;
  versioningEnabled: boolean;
  canPaste: boolean;
  clipboardMode?: ClipboardState["mode"] | null;
  copyUrlDisabled?: boolean;
  copyUrlDisabledReason?: string;
  publicLinkAvailable?: boolean;
  restoreAvailable?: boolean;
  inspectorAvailable?: boolean;
  currentPath?: string;
  showFolderItems?: boolean;
  showDeletedObjects?: boolean;
  functionalProfile?: BrowserFunctionalProfile;
  capabilityFacts?: BrowserCapabilityFacts;
  previewAvailable?: boolean;
  operationPending?: boolean;
  refreshPending?: boolean;
  multipartUploadsAvailable?: boolean;
  bucketConfigurationAvailable?: boolean;
};

export const CONTEXT_MENU_PATH_ACTION_IDS: BrowserActionId[] = [
  "newFolder",
  "uploadFiles",
  "uploadFolder",
  "paste",
  "versions",
  "restoreToDate",
  "cleanOldVersions",
  "multipartUploads",
  "configureBucket",
  "copyPath",
];

export const CONTEXT_MENU_PATH_LAYOUT_ACTION_IDS: BrowserActionId[] = [
  "toggleShowFolders",
  "toggleShowDeleted",
];

export const CONTEXT_MENU_ITEM_ACTION_IDS: BrowserActionId[] = [
  "details",
  "preview",
  "versions",
  "properties",
  "open",
  "download",
  "createPublicLink",
  "restore",
  "copyUrl",
  "copy",
  "cut",
  "bulkAttributes",
  "restoreToDate",
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
  "uploadFiles",
  "uploadFolder",
  "newFolder",
  "paste",
  "versions",
  "restoreToDate",
  "cleanOldVersions",
  "multipartUploads",
  "configureBucket",
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

const ALL_ACTION_IDS: BrowserActionId[] = [
  "uploadFiles",
  "uploadFolder",
  "newFolder",
  "paste",
  "versions",
  "restoreToDate",
  "cleanOldVersions",
  "multipartUploads",
  "configureBucket",
  "copyPath",
  "refresh",
  "toggleShowFolders",
  "toggleShowDeleted",
  "details",
  "properties",
  "open",
  "preview",
  "download",
  "createPublicLink",
  "restore",
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
  multipartUploads: "path",
  configureBucket: "path",
  copyPath: "path",
  refresh: "path",
  toggleShowFolders: "layout",
  toggleShowDeleted: "layout",
  details: "selection",
  properties: "selection",
  open: "selection",
  preview: "selection",
  download: "selection",
  createPublicLink: "selection",
  restore: "selection",
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

export function runBrowserAction(
  action: BrowserActionState,
  handlers: Partial<Record<BrowserActionId, BrowserActionHandler>>,
): BrowserActionDispatcherResult {
  if (!action.visible) {
    return { executed: false, reason: "This action is not available in the current Browser profile." };
  }
  if (!action.enabled) {
    return {
      executed: false,
      reason: action.disabledReason ?? "This action is temporarily unavailable.",
    };
  }
  const handler = handlers[action.id];
  if (!handler) {
    return { executed: false, reason: "This action is not supported from this surface." };
  }
  void handler();
  return { executed: true };
}

const STANDARD_PATH_ACTION_IDS = new Set<BrowserActionId>([
  "uploadFiles",
  "uploadFolder",
  "newFolder",
  "paste",
  "copyPath",
  "toggleShowDeleted",
  "refresh",
]);

const STANDARD_SELECTION_ACTION_IDS = new Set<BrowserActionId>([
  "details",
  "properties",
  "open",
  "preview",
  "download",
  "copy",
  "cut",
  "delete",
]);

const PORTAL_PATH_ACTION_IDS = new Set<BrowserActionId>([
  "uploadFiles",
  "uploadFolder",
  "newFolder",
  "copyPath",
  "toggleShowDeleted",
  "restore",
  "refresh",
]);

const PORTAL_SELECTION_ACTION_IDS = new Set<BrowserActionId>([
  "details",
  "open",
  "preview",
  "download",
  "createPublicLink",
  "restore",
  "delete",
]);

const WRITE_ACTION_IDS = new Set<BrowserActionId>([
  "uploadFiles",
  "uploadFolder",
  "newFolder",
  "paste",
  "copy",
  "cut",
  "bulkAttributes",
]);

function applyBrowserFunctionalPolicy(
  actions: BrowserActionMap,
  profile: BrowserFunctionalProfile,
  capabilityFacts: BrowserCapabilityFacts,
  items: BrowserItem[] = [],
): BrowserActionMap {
  const canOpenSingleFolder = items.length === 1 && items[0]?.type === "folder";
  return Object.fromEntries(
    Object.entries(actions).map(([id, action]) => {
      const actionId = id as BrowserActionId;
      const profileAllows =
        profile === "advanced" ||
        (profile === "standard" &&
          (STANDARD_PATH_ACTION_IDS.has(actionId) ||
            STANDARD_SELECTION_ACTION_IDS.has(actionId))) ||
        (profile === "portal" &&
          (PORTAL_PATH_ACTION_IDS.has(actionId) ||
            PORTAL_SELECTION_ACTION_IDS.has(actionId) ||
            (actionId === "open" && canOpenSingleFolder)));
      const capabilityAllows =
        (!WRITE_ACTION_IDS.has(actionId) || capabilityFacts.canWriteObjects) &&
        (actionId !== "delete" || capabilityFacts.canDeleteObjects) &&
        ((actionId !== "restoreToDate" && actionId !== "restore") ||
          capabilityFacts.canRestoreObjects) &&
        (actionId !== "createPublicLink" || capabilityFacts.canCreatePublicLinks);
      const allowed = profileAllows && capabilityAllows;
      return [
        actionId,
        allowed ? action : { ...action, visible: false, enabled: false },
      ];
    }),
  ) as BrowserActionMap;
}

export const isBrowserItemPreviewAvailable = (item: BrowserItem): boolean =>
  item.type === "file" &&
  !item.isDeleted &&
  typeof item.sizeBytes === "number" &&
  item.sizeBytes >= 0 &&
  item.sizeBytes <= OBJECT_PREVIEW_MAX_BYTES &&
  objectPreviewKind(item.name) !== "generic";

export function resolveItemPrimaryAction(
  item: BrowserItem,
  options: { versioningEnabled: boolean },
): BrowserItemPrimaryAction {
  if (item.type === "folder") {
    return { kind: "open-folder" };
  }
  if (item.isDeleted) {
    return options.versioningEnabled ? { kind: "open-versions" } : { kind: "none" };
  }
  return {
    kind: "open-file",
    initialTab: "preview",
  };
}

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
  publicLinkAvailable = false,
  restoreAvailable = false,
  inspectorAvailable = false,
  currentPath = "",
  showFolderItems = true,
  showDeletedObjects = false,
  functionalProfile = "advanced",
  capabilityFacts = FULL_BROWSER_CAPABILITY_FACTS,
  previewAvailable = false,
  operationPending = false,
  refreshPending = false,
  multipartUploadsAvailable = false,
  bucketConfigurationAvailable = false,
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

  const finalize = () => {
    const resolved = applyBrowserFunctionalPolicy(
      states,
      functionalProfile,
      capabilityFacts,
      items,
    );
    if (!operationPending) return resolved;
    return Object.fromEntries(
      Object.entries(resolved).map(([id, action]) => [
        id,
        action.visible && action.enabled
          ? {
              ...action,
              enabled: false,
              disabledReason: "Wait for the current operation to finish.",
            }
          : action,
      ]),
    ) as BrowserActionMap;
  };

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
      disabledReason: canPaste
        ? undefined
        : "Clipboard is empty or unavailable in this context.",
    });
    setState("copyPath", {
      label: "Copy path",
      visible: true,
      enabled: Boolean(currentPath),
    });
    setState("refresh", {
      label: "Refresh",
      visible: true,
      enabled: canUseContextActions && !refreshPending,
      disabledReason: refreshPending
        ? "Objects are already loading."
        : undefined,
    });
    setState("multipartUploads", {
      label: "Multipart uploads",
      visible: multipartUploadsAvailable,
      enabled: multipartUploadsAvailable && canUseContextActions,
      disabledReason: canUseContextActions
        ? undefined
        : "Select a bucket to inspect multipart uploads.",
    });
    setState("configureBucket", {
      label: "Configure bucket",
      visible: bucketConfigurationAvailable,
      enabled: bucketConfigurationAvailable && canUseContextActions,
      disabledReason: canUseContextActions
        ? undefined
        : "Select a bucket to configure it.",
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
        label: showDeletedObjects
          ? "Hide deleted files"
          : "Show deleted files",
        visible: true,
        enabled: true,
      });
      if (restoreAvailable && currentPath) {
        setState("restore", {
          label: "Restore deleted files in this folder",
          visible: true,
          enabled: canUseContextActions,
        });
      }
    }
    return finalize();
  }

  if (scope === "item") {
    setState("details", {
      label: "Details",
      visible:
        isSingle &&
        Boolean(primary) &&
        inspectorAvailable,
      enabled:
        isSingle &&
        Boolean(primary) &&
        inspectorAvailable,
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
        visible: previewAvailable,
        enabled: canUseContextActions && !isPrimaryDeleted,
      });
      setState("properties", {
        label: "Properties",
        visible: true,
        enabled: canUseContextActions && (!isPrimaryDeleted || versioningEnabled),
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
      if (publicLinkAvailable) {
        setState("createPublicLink", {
          label: "Create public link",
          visible: true,
          enabled: canUseContextActions,
        });
      }
      setState("copyUrl", {
        label: "Copy URL",
        visible: true,
        enabled: canUseContextActions && !copyUrlDisabled,
        disabledReason: copyUrlDisabled ? copyUrlDisabledReason : undefined,
      });
    }
    if (isPrimaryFile && isPrimaryDeleted && versioningEnabled && restoreAvailable) {
      setState("restore", {
        label: "Restore",
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
    return finalize();
  }

  if (selectionInfo.items.length > 0) {
    if (selectionInfo.canDownloadFolder || selectionInfo.canDownloadFiles) {
      setState("download", {
        label: downloadLabel,
        visible: true,
        enabled: canUseContextActions,
      });
    }
    if (isSingle && selectionInfo.primary) {
      setState("details", {
        label: "Open full details",
        visible: true,
        enabled: canUseContextActions,
      });
      setState("open", {
        label: "Open",
        visible: true,
        enabled:
          hasBucket &&
          canUseContextActions &&
          (!isPrimaryDeleted || versioningEnabled),
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
  return finalize();
};
