import type { ComponentType } from "react";

import {
  contextMenuItemClasses,
  contextMenuItemDisabledClasses,
} from "./browserConstants";
import {
  CopyIcon,
  CutIcon,
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
import type { BrowserActionId, BrowserActionState } from "./browserActions";

type ActionIconComponent = ComponentType<{ className?: string }>;

const actionIconById = {
  uploadFiles: UploadIcon,
  uploadFolder: FolderIcon,
  newFolder: FolderPlusIcon,
  paste: PasteIcon,
  versions: ListIcon,
  restoreToDate: HistoryIcon,
  cleanOldVersions: TrashIcon,
  multipartUploads: UploadIcon,
  configureBucket: SettingsIcon,
  copyPath: CopyIcon,
  refresh: RefreshIcon,
  toggleShowFolders: FolderIcon,
  toggleShowDeleted: TrashIcon,
  details: InfoIcon,
  properties: InfoIcon,
  open: OpenIcon,
  preview: EyeIcon,
  download: DownloadIcon,
  createPublicLink: LinkIcon,
  restore: HistoryIcon,
  copyUrl: LinkIcon,
  copy: CopyIcon,
  cut: CutIcon,
  bulkAttributes: SlidersIcon,
  advanced: SettingsIcon,
  delete: TrashIcon,
} satisfies Record<BrowserActionId, ActionIconComponent>;

type BrowserActionIconProps = {
  actionId: BrowserActionId;
  className?: string;
};

export function BrowserActionIcon({
  actionId,
  className = "h-3.5 w-3.5",
}: BrowserActionIconProps) {
  const Icon = actionIconById[actionId];
  return <Icon className={className} />;
}

type BrowserDirectItemActionButtonProps = {
  action: BrowserActionState;
  itemName: string;
  className: string;
  onSelect: () => void;
};

export function BrowserDirectItemActionButton({
  action,
  itemName,
  className,
  onSelect,
}: BrowserDirectItemActionButtonProps) {
  const accessibleLabel = `${action.label} ${itemName}`;
  const disabledLabel =
    !action.enabled && action.disabledReason
      ? `${accessibleLabel}. Unavailable: ${action.disabledReason}`
      : accessibleLabel;
  return (
    <button
      type="button"
      className={`${className} ${
        action.id === "delete"
          ? "text-rose-600 hover:text-rose-700 dark:text-rose-300 dark:hover:text-rose-200"
          : ""
      }`}
      aria-label={disabledLabel}
      title={action.enabled ? action.label : action.disabledReason}
      disabled={!action.enabled}
      onClick={(event) => {
        event.stopPropagation();
        onSelect();
      }}
    >
      <BrowserActionIcon actionId={action.id} />
    </button>
  );
}

type BrowserToolbarActionMenuItemProps = {
  action: BrowserActionState;
  onSelect: () => void;
};

export function BrowserToolbarActionMenuItem({
  action,
  onSelect,
}: BrowserToolbarActionMenuItemProps) {
  return (
    <button
      type="button"
      role="menuitem"
      className={`${contextMenuItemClasses} ${
        !action.enabled ? contextMenuItemDisabledClasses : ""
      }`}
      onClick={onSelect}
      disabled={!action.enabled}
      title={action.disabledReason}
    >
      <BrowserActionIcon actionId={action.id} />
      {action.label}
    </button>
  );
}
