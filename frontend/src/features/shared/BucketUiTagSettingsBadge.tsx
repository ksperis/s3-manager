/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useEffect, useRef, useState } from "react";

import type {
  BucketUiTagDefinition,
  BucketUiTagDefinitionPatch,
  BucketUiTagVisibility,
} from "../../api/bucketUiTags";
import {
  UiTagBadge,
  UiTagColorPalette,
  UiTagScopeSettings,
  UiTagSettingsPopover,
} from "../../components/UiTagSettings";
import UiButton from "../../components/ui/UiButton";
import UiSegmentedControl from "../../components/ui/UiSegmentedControl";
import { uiLabelClass } from "../../components/ui/styles";
import { useConfirmActionDialog } from "../../components/useConfirmActionDialog";

export type BucketUiTagDraft = {
  draftId: string;
  label: string;
  color_key: string;
  scope: "standard";
  visibility: BucketUiTagVisibility;
};

type ConfigurableBucketUiTag = BucketUiTagDefinition | BucketUiTagDraft;

type BucketUiTagSettingsBadgeProps = {
  tag: ConfigurableBucketUiTag;
  isStorageOps: boolean;
  disabled?: boolean;
  initiallyOpen?: boolean;
  onChange: (
    changes: BucketUiTagDefinitionPatch
  ) => void | BucketUiTagDefinition | Promise<void | BucketUiTagDefinition>;
  onRemove?: () => void;
  onCommit?: () => void | Promise<void>;
  className?: string;
};

const isPersisted = (
  tag: ConfigurableBucketUiTag
): tag is BucketUiTagDefinition => "id" in tag;

export default function BucketUiTagSettingsBadge({
  tag,
  isStorageOps,
  disabled = false,
  initiallyOpen = false,
  onChange,
  onRemove,
  onCommit,
  className,
}: BucketUiTagSettingsBadgeProps) {
  const [open, setOpen] = useState(initiallyOpen);
  const [saving, setSaving] = useState(false);
  const anchorRef = useRef<HTMLSpanElement | null>(null);
  const visibilityConfirmation = useConfirmActionDialog();
  const persisted = isPersisted(tag);
  const busy = disabled || saving || visibilityConfirmation.isConfirming;

  useEffect(() => {
    if (initiallyOpen) setOpen(true);
  }, [initiallyOpen]);

  const applyChange = async (changes: BucketUiTagDefinitionPatch) => {
    if (busy) return;
    setSaving(true);
    try {
      await onChange(changes);
    } catch {
      // The owning hook surfaces the request error in the workbench banner.
    } finally {
      setSaving(false);
    }
  };

  const changeVisibility = (visibility: BucketUiTagVisibility) => {
    if (visibility === tag.visibility || busy || isStorageOps) return;
    if (!persisted) {
      void applyChange({ visibility });
      return;
    }
    const toShared = visibility === "shared";
    visibilityConfirmation.requestConfirmation({
      title: "Change UI tag visibility?",
      description: toShared
        ? "This UI tag will become visible and configurable to every Ceph Admin."
        : "This UI tag will become private to your Ceph Admin account.",
      confirmLabel: toShared ? "Make shared" : "Make private",
      details: [
        { label: "UI tag", value: tag.label },
        { label: "Current visibility", value: tag.visibility === "shared" ? "Shared" : "Private" },
        { label: "New visibility", value: toShared ? "Shared" : "Private" },
      ],
      impacts: [
        "The definition identifier and every existing bucket association will be preserved.",
        toShared
          ? "Other Ceph Admins will see this tag and may change its settings."
          : "Other Ceph Admins will no longer see this tag.",
      ],
      onConfirm: () => applyChange({ visibility }),
      zIndexClass: "z-[100]",
    });
  };

  return (
    <>
      <span ref={anchorRef}>
        <UiTagBadge
          label={tag.label}
          colorKey={tag.color_key}
          visibility={tag.visibility}
          active={open}
          disabled={busy}
          className={className}
          onClick={() => setOpen((current) => !current)}
          onRemove={onRemove}
          removeAriaLabel={`Remove UI tag ${tag.label}, ${tag.visibility === "shared" ? "Shared" : "Private"}`}
        />
      </span>
      <UiTagSettingsPopover
        open={open}
        anchorRef={anchorRef}
        label={tag.label}
        colorKey={tag.color_key}
        visibility={tag.visibility}
        description={
          persisted
            ? tag.visibility === "shared"
              ? "Shared UI tag. Every Ceph Admin can use and configure it."
              : isStorageOps
                ? "Private UI tag. It is visible only to your Storage Ops account."
                : "Private UI tag. It is visible only to your Ceph Admin account."
            : "This new UI tag stays local until you add it."
        }
        onDismiss={() => setOpen(false)}
        footer={
          !persisted && onCommit ? (
            <div className="flex justify-end border-t border-slate-200 pt-3 dark:border-slate-700">
              <UiButton
                type="button"
                size="sm"
                disabled={busy}
                loading={saving}
                onClick={() => void onCommit()}
              >
                Add tag
              </UiButton>
            </div>
          ) : undefined
        }
      >
        <UiTagColorPalette
          label={tag.label}
          value={tag.color_key}
          disabled={busy}
          onChange={(color_key) => applyChange({ color_key })}
        />
        {!isStorageOps && (
          <div className="space-y-2">
            <span className={uiLabelClass}>Visibility</span>
            <UiSegmentedControl
              ariaLabel={`Visibility for UI tag ${tag.label}`}
              value={tag.visibility}
              onChange={changeVisibility}
              options={[
                { value: "private", label: "Private", disabled: busy },
                { value: "shared", label: "Shared", disabled: busy },
              ]}
            />
            <p className="ui-caption text-slate-500 dark:text-slate-400">
              Private tags belong to one Ceph Admin. Shared tags are available to every Ceph Admin.
            </p>
          </div>
        )}
        <UiTagScopeSettings
          value="standard"
          readOnly
          help="Bucket UI tags always use the Standard scope."
        />
      </UiTagSettingsPopover>
      {visibilityConfirmation.confirmationDialog}
    </>
  );
}
