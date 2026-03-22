/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import type { ReactNode } from "react";
import type { WorkspaceContextStripAlert, WorkspaceContextStripItem } from "./WorkspaceContextStrip";
import { cx, uiCardMutedClass, uiToneBannerClasses } from "./ui/styles";
import UiBadge from "./ui/UiBadge";

type PageControlStripProps = {
  label: string;
  title: ReactNode;
  description?: ReactNode;
  controls?: ReactNode;
  items?: WorkspaceContextStripItem[];
  alerts?: WorkspaceContextStripAlert[];
  className?: string;
};

export default function PageControlStrip({
  label,
  title,
  description,
  controls,
  items = [],
  alerts = [],
  className,
}: PageControlStripProps) {
  const visibleItems = items.filter((item) => item.value !== null && item.value !== undefined && item.value !== "");

  return (
    <section className={cx(uiCardMutedClass, "space-y-3 px-4 py-4", className)}>
      <div className="min-w-0 space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <UiBadge tone="primary" className="px-2.5 py-1">
            {label}
          </UiBadge>
          <p className="ui-body font-semibold text-slate-900 dark:text-slate-50">{title}</p>
        </div>
        {description ? <p className="max-w-4xl ui-caption text-slate-600 dark:text-slate-300">{description}</p> : null}
      </div>

      {controls ? (
        <div className="rounded-xl border border-slate-200/80 bg-white/75 px-3 py-3 shadow-sm dark:border-slate-700 dark:bg-slate-950/40">
          {controls}
        </div>
      ) : null}

      {visibleItems.length > 0 ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {visibleItems.map((item) => (
            <div
              key={item.label}
              className="rounded-xl border border-slate-200/80 bg-white/75 px-3 py-3 shadow-sm dark:border-slate-700 dark:bg-slate-950/40"
              title={item.title}
            >
              <p className="ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                {item.label}
              </p>
              <div className="mt-1 min-w-0">
                {item.tone ? (
                  <UiBadge tone={item.tone} className="max-w-full truncate px-2.5 py-1">
                    {item.value}
                  </UiBadge>
                ) : (
                  <p className={cx("truncate ui-body font-semibold text-slate-800 dark:text-slate-100", item.mono && "font-mono text-[13px]")}>
                    {item.value}
                  </p>
                )}
              </div>
            </div>
          ))}
        </div>
      ) : null}

      {alerts.length > 0 ? (
        <div className="grid gap-2">
          {alerts.map((alert, index) => (
            <div
              key={index}
              className={cx("rounded-lg border px-3 py-2 ui-caption", uiToneBannerClasses[alert.tone ?? "neutral"])}
            >
              {alert.message}
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}
