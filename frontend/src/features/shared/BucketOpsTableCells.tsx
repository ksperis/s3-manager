/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useRef } from "react";
import type { Ref, RefObject } from "react";
import type { CephAdminBucket } from "../../api/cephAdminBuckets";
import AnchoredPortalMenu from "../../components/ui/AnchoredPortalMenu";
import { uiCheckboxClass } from "../../components/ui/styles";
import {
  BucketFeatureSummaryChip,
  BucketSummaryTooltip,
  BucketTooltipSpinnerIcon,
  type BucketFeatureTooltipState,
} from "./BucketFeatureSummaryTooltip";
import {
  FEATURE_LABELS,
  type FeatureKey,
} from "./bucketOpsAdvancedFilterModel";
import { buildBucketTagSummaryLines } from "./bucketFeatureSummaries";
import { getBucketDisplayName, getTagColors } from "./bucketOpsPresentation";

type OwnerTooltipState =
  | { status: "loading" }
  | { status: "ready"; ownerName: string | null }
  | { status: "error"; message: string };

const toAnchorRef = (
  node: HTMLElement | null,
): RefObject<HTMLElement | null> => ({ current: node });

export function getBucketOpsS3TagsTooltipKey(bucket: CephAdminBucket): string {
  return `${bucket.tenant ?? ""}:${bucket.name}:tags`;
}

export function BucketOpsSelectionHeader({
  checked,
  disabled,
  inputRef,
  onChange,
}: {
  checked: boolean;
  disabled: boolean;
  inputRef: Ref<HTMLInputElement>;
  onChange: (checked: boolean) => void;
}) {
  return (
    <input
      ref={inputRef}
      type="checkbox"
      aria-label="Select all filtered buckets"
      checked={checked}
      onChange={(event) => onChange(event.target.checked)}
      disabled={disabled}
      className={uiCheckboxClass}
    />
  );
}

export function BucketOpsSelectionCell({
  bucket,
  isStorageOps,
  onToggle,
  selected,
  useExplicitBucketName,
}: {
  bucket: CephAdminBucket;
  isStorageOps: boolean;
  onToggle: () => void;
  selected: boolean;
  useExplicitBucketName: boolean;
}) {
  const contextLabel =
    isStorageOps && bucket.context_name ? ` in ${bucket.context_name}` : "";
  return (
    <input
      type="checkbox"
      aria-label={`Select bucket ${getBucketDisplayName(bucket, useExplicitBucketName)}${contextLabel}`}
      checked={selected}
      onChange={onToggle}
      className={uiCheckboxClass}
    />
  );
}

export function BucketOpsNameCell({
  bucket,
  onConfigure,
  useExplicitBucketName,
}: {
  bucket: CephAdminBucket;
  onConfigure: () => void;
  useExplicitBucketName: boolean;
}) {
  const displayName = getBucketDisplayName(bucket, useExplicitBucketName);
  return (
    <button
      type="button"
      onClick={onConfigure}
      data-bucket-row-key={bucket.name}
      className="block w-full truncate text-left hover:text-primary-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary dark:hover:text-primary-200"
      title={`Configure ${displayName} with the S3 API`}
    >
      {displayName}
    </button>
  );
}

export function BucketOpsS3TagsCell({
  bucket,
  open,
  onClose,
  onOpen,
}: {
  bucket: CephAdminBucket;
  open: boolean;
  onClose: () => void;
  onOpen: () => void;
}) {
  const safeTags = Array.isArray(bucket.tags)
    ? bucket.tags.filter((tag) => (tag.key ?? "").trim())
    : [];
  if (safeTags.length === 0) {
    return <span className="ui-body text-slate-500 dark:text-slate-400">-</span>;
  }

  const shown = safeTags.slice(0, 3);
  const remaining = safeTags.length - shown.length;
  const tooltipKey = getBucketOpsS3TagsTooltipKey(bucket);
  const tooltip: BucketFeatureTooltipState = {
    status: "ready",
    lines: buildBucketTagSummaryLines(safeTags),
  };

  return (
    <BucketSummaryTooltip
      label="S3 tags"
      tooltip={tooltip}
      open={open}
      onOpen={onOpen}
      onClose={onClose}
      cacheKey={tooltipKey}
      buttonClassName="inline-flex max-w-full cursor-default text-left"
    >
      <div className="flex flex-wrap gap-1.5">
        {shown.map((tag) => {
          const label = `${tag.key}=${tag.value}`;
          const colors = getTagColors(label);
          return (
            <span
              key={`${tag.key}:${tag.value}`}
              className="rounded-full border px-2 py-0.5 ui-caption font-semibold"
              style={{
                backgroundColor: colors.background,
                color: colors.text,
                borderColor: colors.border,
              }}
            >
              {label}
            </span>
          );
        })}
        {remaining > 0 && (
          <span className="rounded-full border border-slate-200 px-2 py-0.5 ui-caption font-semibold text-slate-600 dark:border-slate-700 dark:text-slate-300">
            +{remaining}
          </span>
        )}
      </div>
    </BucketSummaryTooltip>
  );
}

export function BucketOpsOwnerCell({
  bucket,
  onClose,
  onOpen,
  open,
  tooltip,
}: {
  bucket: CephAdminBucket;
  onClose: () => void;
  onOpen: () => void;
  open: boolean;
  tooltip?: OwnerTooltipState;
}) {
  const anchorRef = useRef<HTMLButtonElement | null>(null);
  const owner = (bucket.owner || "").trim();
  if (!owner) return "-";

  return (
    <div
      className="relative inline-flex"
      onMouseEnter={onOpen}
      onMouseLeave={onClose}
    >
      <button
        ref={anchorRef}
        type="button"
        className="inline-flex cursor-help text-left decoration-dotted underline-offset-2 hover:underline focus:underline"
        onFocus={onOpen}
        onBlur={onClose}
        aria-label="Resolve owner name"
      >
        {owner}
      </button>
      <AnchoredPortalMenu
        open={open}
        anchorRef={toAnchorRef(anchorRef.current)}
        placement="bottom-start"
        offset={4}
        minWidth={288}
        className="pointer-events-none w-72 rounded-lg border border-slate-200 bg-white p-2 shadow-lg dark:border-slate-700 dark:bg-slate-900"
      >
        <div>
          <p className="ui-caption font-semibold text-slate-800 dark:text-slate-100">
            Owner
          </p>
          <p className="mt-1 ui-caption text-slate-600 dark:text-slate-300">
            UID: {owner}
          </p>
          {(!tooltip || tooltip.status === "loading") && (
            <div className="mt-1.5 inline-flex items-center gap-1.5 ui-caption text-slate-500 dark:text-slate-300">
              <BucketTooltipSpinnerIcon />
              Resolving owner name...
            </div>
          )}
          {tooltip?.status === "error" && (
            <p className="mt-1.5 ui-caption text-rose-600 dark:text-rose-300">
              {tooltip.message}
            </p>
          )}
          {tooltip?.status === "ready" && (
            <p className="mt-1.5 ui-caption text-slate-600 dark:text-slate-300">
              Owner name: {tooltip.ownerName ? tooltip.ownerName : "Not found"}
            </p>
          )}
        </div>
      </AnchoredPortalMenu>
    </div>
  );
}

export function BucketOpsFeatureCell({
  bucket,
  cacheKey,
  featureKey,
  onClose,
  onOpen,
  open,
  tooltip,
}: {
  bucket: CephAdminBucket;
  cacheKey: string;
  featureKey: FeatureKey;
  onClose: () => void;
  onOpen: () => void;
  open: boolean;
  tooltip?: BucketFeatureTooltipState;
}) {
  const status = bucket.features?.[featureKey] ?? null;
  if (!status) {
    return <span className="ui-body text-slate-500 dark:text-slate-400">-</span>;
  }

  return (
    <BucketFeatureSummaryChip
      label={FEATURE_LABELS[featureKey]}
      state={status.state}
      tone={status.tone}
      tooltip={tooltip}
      open={open}
      onOpen={onOpen}
      onClose={onClose}
      cacheKey={cacheKey}
    />
  );
}
