/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useRef, useState } from "react";

import Modal from "../../components/Modal";
import UiActionMenu, { type UiActionMenuSection } from "../../components/ui/UiActionMenu";
import UiButton from "../../components/ui/UiButton";
import UiSegmentedControl from "../../components/ui/UiSegmentedControl";
import {
  cx,
  uiButtonBaseClass,
  uiButtonVariants,
  uiInputClass,
  uiMenuItemClass,
  uiMutedTextClass,
  uiTitleTextClass,
} from "../../components/ui/styles";
import ActionProgressCard from "./ActionProgressCard";
import type { ActionProgressState } from "./actionProgress";
import { bucketAction, BUCKET_ACTION_GROUP_LABELS } from "./bucketActionCatalog";
import type {
  BucketUiTagDefinition,
  BucketUiTagDefinitionPatch,
} from "../../api/bucketUiTags";
import BucketUiTagSettingsBadge from "./BucketUiTagSettingsBadge";
import {
  createBucketUiTagDrafts,
  type BucketUiTagDraft,
} from "./bucketOpsRowTagModel";

type SelectionTagAction = "add" | "remove";
type SelectionExportFormat = "text" | "csv" | "json";

type BucketSelectionActionsBarProps = {
  selectedCount: number;
  hiddenSelectedCount: number;
  clearSelection: () => void;
  availableUiTags: BucketUiTagDefinition[];
  selectedUiTagSuggestions: BucketUiTagDefinition[];
  selectionTagAddInput: string;
  setSelectionTagAddInput: (value: string) => void;
  parsedSelectionTagAddInput: string[];
  selectionTagActionLoading: SelectionTagAction | null;
  applyUiTagToSelection: (
    tag: BucketUiTagDefinition | BucketUiTagDraft[],
    action: SelectionTagAction
  ) => Promise<void> | void;
  updateUiTagDefinition: (
    tag: BucketUiTagDefinition,
    changes: BucketUiTagDefinitionPatch
  ) => Promise<void> | void;
  updatingDefinitionIds: Set<number>;
  selectionExportLoading: SelectionExportFormat | null;
  exportSelectedBuckets: (format: SelectionExportFormat) => Promise<void> | void;
  selectionActionProgress?: ActionProgressState | null;
  isStorageOps: boolean;
  onShowConfigBackupModal?: () => void;
  onShowCompareModal: () => void;
  onShowIndexCheckModal?: () => void;
  onShowIntegrityModal: () => void;
  onShowPurgeModal?: () => void;
  onShowUsageStatsModal: () => void;
  openBulkUpdateModal: () => void;
};

const dialogActionClass = cx(
  uiMenuItemClass,
  "flex w-full items-center justify-between px-3 py-2 text-left ui-caption font-semibold"
);

export default function BucketSelectionActionsBar({
  selectedCount,
  hiddenSelectedCount,
  clearSelection,
  availableUiTags,
  selectedUiTagSuggestions,
  selectionTagAddInput,
  setSelectionTagAddInput,
  parsedSelectionTagAddInput,
  selectionTagActionLoading,
  applyUiTagToSelection,
  updateUiTagDefinition,
  updatingDefinitionIds,
  selectionExportLoading,
  exportSelectedBuckets,
  selectionActionProgress,
  isStorageOps,
  onShowConfigBackupModal,
  onShowCompareModal,
  onShowIndexCheckModal,
  onShowIntegrityModal,
  onShowPurgeModal,
  onShowUsageStatsModal,
  openBulkUpdateModal,
}: BucketSelectionActionsBarProps) {
  const [dialog, setDialog] = useState<"tags" | "export" | null>(null);
  const [tagMode, setTagMode] = useState<SelectionTagAction>("add");
  const [customTagDrafts, setCustomTagDrafts] = useState<BucketUiTagDraft[]>([]);
  const customTagDraftSequenceRef = useRef(0);

  if (selectedCount <= 0) return null;

  const surface = isStorageOps ? "storage-ops" : "ceph-admin";
  const indexSelectionAction = bucketAction("check-index-selection");
  const indexSelectionLimit = indexSelectionAction.maxSelection ?? 200;
  const runAndClose = (action: () => void) => {
    setDialog(null);
    action();
  };
  const sections: UiActionMenuSection[] = [
    {
      id: "selection",
      label: BUCKET_ACTION_GROUP_LABELS.selection,
      items: [
        { ...bucketAction("manage-tags"), onSelect: () => setDialog("tags") },
        { ...bucketAction("export-selection"), onSelect: () => setDialog("export") },
      ],
    },
    {
      id: "s3",
      label: BUCKET_ACTION_GROUP_LABELS.s3,
      items: [
        { ...bucketAction("configure-selection"), onSelect: openBulkUpdateModal },
        { ...bucketAction("check-integrity"), onSelect: onShowIntegrityModal },
        { ...bucketAction("calculate-stats"), onSelect: onShowUsageStatsModal },
        ...(!isStorageOps && onShowConfigBackupModal
          ? [{ ...bucketAction("backup-configs"), onSelect: onShowConfigBackupModal }]
          : []),
        ...(!isStorageOps ? [{ ...bucketAction("compare-buckets"), onSelect: onShowCompareModal }] : []),
      ],
    },
    ...(!isStorageOps && onShowIndexCheckModal
      ? [
          {
            id: "rgw",
            label: BUCKET_ACTION_GROUP_LABELS.rgw,
            items: [
              {
                ...indexSelectionAction,
                disabled: selectedCount > indexSelectionLimit,
                disabledReason: `Bucket index checks are limited to ${indexSelectionLimit} buckets. Narrow the selection to continue.`,
                onSelect: onShowIndexCheckModal,
              },
            ],
          },
        ]
      : []),
    ...(onShowPurgeModal
      ? [
          {
            id: "destructive-s3",
            label: BUCKET_ACTION_GROUP_LABELS["destructive-s3"],
            items: [{ ...bucketAction("purge-contents"), onSelect: onShowPurgeModal }],
          },
        ]
      : []),
  ];

  const tagOptions = tagMode === "add" ? availableUiTags : selectedUiTagSuggestions;

  return (
    <div className="border-b border-[color:var(--ui-border-soft)] px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <p className={cx("ui-body", uiTitleTextClass)}>
            {selectedCount} bucket{selectedCount > 1 ? "s" : ""} selected
            {hiddenSelectedCount > 0 && (
              <span className="ml-2 ui-caption font-semibold text-red-600 dark:text-red-400">
                ({hiddenSelectedCount} not visible)
              </span>
            )}
          </p>
          <UiButton type="button" onClick={clearSelection} variant="secondary" size="sm">
            Clear selection
          </UiButton>
        </div>
        <UiActionMenu
          ariaLabel={`Actions for ${selectedCount} selected bucket${selectedCount > 1 ? "s" : ""}`}
          trigger="Actions…"
          triggerClassName={cx(uiButtonBaseClass, uiButtonVariants.primary, "h-8 px-3 py-1.5 text-xs")}
          sections={sections}
          minWidth={320}
          menuClassName="w-80"
        />
      </div>

      {selectionActionProgress && <ActionProgressCard progress={selectionActionProgress} busy className="mt-3" />}

      {dialog === "tags" && (
        <Modal title="Manage UI tags" onClose={() => setDialog(null)} maxWidthClass="max-w-lg">
          <div className="space-y-4">
            <p className={cx("ui-caption", uiMutedTextClass)}>
              Update UI-only labels for {selectedCount} selected bucket{selectedCount > 1 ? "s" : ""} in {surface === "storage-ops" ? "Storage Ops" : "Ceph Admin"}.
            </p>
            <UiSegmentedControl
              ariaLabel="UI tag operation"
              value={tagMode}
              onChange={setTagMode}
              options={[
                { value: "add", label: "Add tags" },
                { value: "remove", label: "Remove tags" },
              ]}
            />
            <div className="max-h-56 space-y-1 overflow-auto rounded-md border border-[color:var(--ui-border-soft)] p-2">
              {tagOptions.length === 0 ? (
                <p className={cx("px-2 py-3 ui-caption", uiMutedTextClass)}>
                  {tagMode === "add" ? "No existing UI tags yet." : "No UI tags found on this selection."}
                </p>
              ) : (
                tagOptions.map((tag) => (
                  <div
                    key={`${tagMode}:${tag.id}`}
                    className="flex items-center justify-between gap-2 rounded-md px-2 py-1 hover:bg-slate-100 dark:hover:bg-slate-800"
                  >
                    <BucketUiTagSettingsBadge
                      tag={tag}
                      isStorageOps={isStorageOps}
                      disabled={updatingDefinitionIds.has(tag.id)}
                      onChange={(changes) => updateUiTagDefinition(tag, changes)}
                    />
                    <button
                      type="button"
                      className={cx(dialogActionClass, "w-auto px-2")}
                      disabled={selectionTagActionLoading !== null}
                      aria-label={`${tagMode === "add" ? "Add" : "Remove"} UI tag ${tag.label}`}
                      onClick={() =>
                        runAndClose(() => void applyUiTagToSelection(tag, tagMode))
                      }
                    >
                      <span aria-hidden="true">{tagMode === "add" ? "+" : "−"}</span>
                    </button>
                  </div>
                ))
              )}
            </div>
            {tagMode === "add" && (
              <div className="space-y-3">
                <label htmlFor="bucket-selection-custom-tag" className={cx("ui-caption font-semibold", uiTitleTextClass)}>
                  New UI tags
                </label>
                {customTagDrafts.length > 0 && (
                  <div className="flex flex-wrap gap-2 rounded-md border border-[color:var(--ui-border-soft)] p-2">
                    {customTagDrafts.map((draft, index) => (
                      <BucketUiTagSettingsBadge
                        key={draft.draftId}
                        tag={draft}
                        isStorageOps={isStorageOps}
                        initiallyOpen={index === customTagDrafts.length - 1}
                        onChange={(changes) =>
                          setCustomTagDrafts((current) =>
                            current.map((item) =>
                              item.draftId === draft.draftId
                                ? { ...item, ...changes }
                                : item
                            )
                          )
                        }
                        onRemove={() =>
                          setCustomTagDrafts((current) =>
                            current.filter((item) => item.draftId !== draft.draftId)
                          )
                        }
                      />
                    ))}
                  </div>
                )}
                <div className="flex items-center gap-2">
                  <input
                    id="bucket-selection-custom-tag"
                    type="text"
                    value={selectionTagAddInput}
                    onChange={(event) => setSelectionTagAddInput(event.target.value)}
                    placeholder="new-tag"
                    className={cx(uiInputClass, "min-w-0 flex-1 px-2 py-1.5 ui-caption")}
                  />
                  <UiButton
                    type="button"
                    size="sm"
                    disabled={parsedSelectionTagAddInput.length === 0 || selectionTagActionLoading !== null}
                    onClick={() => {
                      customTagDraftSequenceRef.current += 1;
                      setCustomTagDrafts((current) => [
                        ...current,
                        ...createBucketUiTagDrafts(
                          parsedSelectionTagAddInput,
                          customTagDraftSequenceRef.current,
                        ),
                      ]);
                      setSelectionTagAddInput("");
                    }}
                  >
                    Configure
                  </UiButton>
                </div>
                {customTagDrafts.length > 0 && (
                  <div className="flex justify-end">
                    <UiButton
                      type="button"
                      size="sm"
                      disabled={selectionTagActionLoading !== null}
                      loading={selectionTagActionLoading === "add"}
                      onClick={() =>
                        runAndClose(() =>
                          void applyUiTagToSelection(customTagDrafts, "add")
                        )
                      }
                    >
                      Add {customTagDrafts.length} tag
                      {customTagDrafts.length > 1 ? "s" : ""}
                    </UiButton>
                  </div>
                )}
              </div>
            )}
          </div>
        </Modal>
      )}

      {dialog === "export" && (
        <Modal title="Export selection" onClose={() => setDialog(null)} maxWidthClass="max-w-md">
          <div className="space-y-3">
            <p className={cx("ui-caption", uiMutedTextClass)}>
              Choose the output for {selectedCount} selected bucket{selectedCount > 1 ? "s" : ""}.
            </p>
            {([
              ["text", "Text", "Bucket names only"],
              ["csv", "CSV", "Currently selected columns"],
              ["json", "JSON", "Currently selected columns"],
            ] as const).map(([format, label, helper]) => (
              <button
                key={format}
                type="button"
                className={dialogActionClass}
                disabled={selectionExportLoading !== null}
                onClick={() => runAndClose(() => void exportSelectedBuckets(format))}
              >
                <span>{label}</span>
                <span className={cx("font-normal", uiMutedTextClass)}>{helper}</span>
              </button>
            ))}
          </div>
        </Modal>
      )}
    </div>
  );
}
