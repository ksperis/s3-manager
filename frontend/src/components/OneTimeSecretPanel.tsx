/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import type { ReactNode } from "react";

import UiButton from "./ui/UiButton";
import { cx } from "./ui/styles";

type OneTimeSecretValue = {
  label: ReactNode;
  value: string;
  copyLabel?: ReactNode;
};

type OneTimeSecretPanelProps = {
  title: ReactNode;
  description: ReactNode;
  values: OneTimeSecretValue[];
  badge?: ReactNode;
  actions?: ReactNode;
  className?: string;
};

function copyValue(value: string) {
  if (!value || typeof navigator === "undefined" || !navigator.clipboard?.writeText) return;
  navigator.clipboard.writeText(value).catch(() => {});
}

export default function OneTimeSecretPanel({
  title,
  description,
  values,
  badge,
  actions,
  className,
}: OneTimeSecretPanelProps) {
  return (
    <div
      className={cx(
        "rounded-md border border-amber-200 bg-amber-50 px-4 py-3 ui-body text-amber-800 dark:border-amber-900/40 dark:bg-amber-950/60 dark:text-amber-100",
        className
      )}
    >
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="font-semibold">{title}</p>
          <p className="ui-caption text-amber-700 dark:text-amber-200">{description}</p>
        </div>
        {(actions || badge) && (
          <div className="flex flex-wrap items-center gap-2 sm:justify-end">
            {actions}
            {badge && (
              <span className="rounded-full bg-amber-100 px-3 py-1 ui-caption font-semibold uppercase tracking-wide text-amber-700 dark:bg-amber-900/40 dark:text-amber-100">
                {badge}
              </span>
            )}
          </div>
        )}
      </div>
      <div className={cx("mt-3 grid grid-cols-1 gap-2", values.length > 1 && "sm:grid-cols-2")}>
        {values.map((item, index) => (
          <div key={`${index}-${item.value}`}>
            <div className="ui-caption uppercase tracking-wide text-amber-600 dark:text-amber-200">{item.label}</div>
            <div className="flex flex-wrap items-center gap-2">
              <div className="max-w-full break-all rounded border border-amber-200 bg-white/80 px-3 py-2 font-mono ui-caption text-slate-800 dark:border-amber-800 dark:bg-amber-50/10 dark:text-amber-100">
                {item.value}
              </div>
              {item.copyLabel && (
                <UiButton type="button" variant="secondary" size="xs" onClick={() => copyValue(item.value)}>
                  {item.copyLabel}
                </UiButton>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
