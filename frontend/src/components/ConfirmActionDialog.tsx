/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import type { ReactNode } from "react";
import Modal from "./Modal";
import UiButton from "./ui/UiButton";

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
  onCancel,
  onConfirm,
}: ConfirmActionDialogProps) {
  return (
    <Modal
      title={title}
      onClose={onCancel}
      maxWidthClass={maxWidthClass}
      closeOnBackdropClick={!loading}
    >
      <div className="space-y-4">
        <p className="ui-body text-slate-600 dark:text-slate-300">{description}</p>

        {details.length > 0 ? (
          <dl className="grid gap-3 rounded-xl border border-slate-200 bg-slate-50/80 px-4 py-4 dark:border-slate-800 dark:bg-slate-950/40">
            {details.map((detail) => (
              <div key={detail.label} className="grid gap-1 sm:grid-cols-[9rem_minmax(0,1fr)] sm:items-start">
                <dt className="ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  {detail.label}
                </dt>
                <dd className={detail.mono ? "break-all font-mono text-[13px] text-slate-700 dark:text-slate-100" : "ui-body font-semibold text-slate-800 dark:text-slate-100"}>
                  {detail.value}
                </dd>
              </div>
            ))}
          </dl>
        ) : null}

        {impacts.length > 0 ? (
          <div className="rounded-xl border border-amber-200 bg-amber-50/80 px-4 py-4 dark:border-amber-900/40 dark:bg-amber-950/30">
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
          <div className="rounded-xl border border-slate-200 bg-slate-50/80 px-4 py-3 ui-caption text-slate-600 dark:border-slate-800 dark:bg-slate-950/40 dark:text-slate-300">
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
