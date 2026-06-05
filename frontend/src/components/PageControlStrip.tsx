/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import type { ReactNode } from "react";
import {
  cx,
  uiCardMutedClass,
  uiLabelClass,
  uiMutedTextClass,
  uiPanelClass,
  uiTitleTextClass,
  uiToneBannerClasses,
} from "./ui/styles";
import UiBadge from "./ui/UiBadge";

export type PageControlStripItem = {
  label: string;
  value: ReactNode;
  tone?: "neutral" | "primary" | "success" | "warning" | "danger";
  mono?: boolean;
  title?: string;
};

export type PageControlStripAlert = {
  tone?: "neutral" | "primary" | "success" | "warning" | "danger";
  message: ReactNode;
};

type PageControlStripProps = {
  label: string;
  title: ReactNode;
  description?: ReactNode;
  controls?: ReactNode;
  items?: PageControlStripItem[];
  alerts?: PageControlStripAlert[];
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
          <p className={cx("ui-body", uiTitleTextClass)}>{title}</p>
        </div>
        {description ? <p className={cx("max-w-4xl ui-caption", uiMutedTextClass)}>{description}</p> : null}
      </div>

      {controls ? (
        <div className={cx(uiPanelClass, "px-3 py-3")}>
          {controls}
        </div>
      ) : null}

      {visibleItems.length > 0 ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {visibleItems.map((item) => (
            <div
              key={item.label}
              className={cx(uiPanelClass, "px-3 py-3")}
              title={item.title}
            >
              <p className={uiLabelClass}>
                {item.label}
              </p>
              <div className="mt-1 min-w-0">
                {item.tone ? (
                  <UiBadge tone={item.tone} className="max-w-full truncate px-2.5 py-1">
                    {item.value}
                  </UiBadge>
                ) : (
                  <p className={cx("truncate ui-body", uiTitleTextClass, item.mono && "font-mono text-[13px]")}>
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
