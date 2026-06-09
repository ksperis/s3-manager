/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import type { ReactNode } from "react";
import Modal from "./Modal";
import UiButton from "./ui/UiButton";
import {
  cx,
  uiMutedTextClass,
  uiPanelMutedClass,
  uiTitleTextClass,
  uiToneBannerClasses,
} from "./ui/styles";

export type ConfirmActionDialogDetail = {
  label: string;
  value: ReactNode;
  mono?: boolean;
};

type ConfirmActionDialogProps = {
  title: string;
  description: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  tone?: "danger" | "primary";
  loading?: boolean;
  confirmDisabled?: boolean;
  details?: ConfirmActionDialogDetail[];
  impacts?: ReactNode[];
  warning?: ReactNode;
  maxWidthClass?: string;
  zIndexClass?: string;
  onCancel: () => void;
  onConfirm: () => void;
};

export default function ConfirmActionDialog({
  title,
  description,
  confirmLabel,
  cancelLabel = "Cancel",
  tone = "danger",
  loading = false,
  confirmDisabled = false,
  details = [],
  impacts = [],
  warning,
  maxWidthClass = "max-w-xl",
  zIndexClass,
  onCancel,
  onConfirm,
}: ConfirmActionDialogProps) {
  return (
    <Modal
      title={title}
      onClose={onCancel}
      maxWidthClass={maxWidthClass}
      zIndexClass={zIndexClass}
      closeOnBackdropClick={!loading}
    >
      <div className="space-y-4">
        <p className={cx("ui-body", uiMutedTextClass)}>{description}</p>

        {details.length > 0 ? (
          <dl className={cx("grid gap-3 px-4 py-4", uiPanelMutedClass)}>
            {details.map((detail) => (
              <div key={detail.label} className="grid gap-1 sm:grid-cols-[9rem_minmax(0,1fr)] sm:items-start">
                <dt className={cx("ui-caption font-semibold uppercase", uiMutedTextClass)}>{detail.label}</dt>
                <dd
                  className={
                    detail.mono
                      ? "break-all font-mono text-[13px] text-[var(--ui-text)]"
                      : cx("ui-body", uiTitleTextClass)
                  }
                >
                  {detail.value}
                </dd>
              </div>
            ))}
          </dl>
        ) : null}

        {impacts.length > 0 ? (
          <div className={cx("rounded-md px-4 py-4", uiToneBannerClasses.warning)}>
            <p className="ui-caption font-semibold uppercase tracking-wide text-amber-800 dark:text-amber-100">
              Impact
            </p>
            <ul className="mt-2 list-disc space-y-1 pl-5 ui-body text-amber-900 dark:text-amber-100">
              {impacts.map((impact, index) => (
                <li key={index}>{impact}</li>
              ))}
            </ul>
          </div>
        ) : null}

        {warning ? (
          <div className={cx("px-4 py-3 ui-caption", uiPanelMutedClass, uiMutedTextClass)}>
            {warning}
          </div>
        ) : null}

        <div className="flex items-center justify-end gap-2">
          <UiButton variant="secondary" onClick={onCancel} disabled={loading}>
            {cancelLabel}
          </UiButton>
          <UiButton
            variant={tone === "danger" ? "danger" : "primary"}
            onClick={onConfirm}
            disabled={loading || confirmDisabled}
          >
            {loading ? "Processing..." : confirmLabel}
          </UiButton>
        </div>
      </div>
    </Modal>
  );
}
