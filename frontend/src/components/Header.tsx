/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { ReactNode } from "react";
import { cx, uiCardClass, uiMutedTextClass, uiTitleTextClass } from "./ui/styles";

type HeaderProps = {
  title: string;
  subtitle?: string;
  context?: string;
  inlineAction?: ReactNode;
};

export default function Header({ title, subtitle, context, inlineAction }: HeaderProps) {
  return (
    <header className={cx("mb-4 px-4 py-3", uiCardClass)}>
      <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
        <div className="space-y-1">
          {subtitle && <p className={cx("ui-caption font-semibold uppercase", uiMutedTextClass)}>{subtitle}</p>}
          <div className="flex flex-wrap items-center gap-3">
            <h1 className={cx("ui-title", uiTitleTextClass)}>{title}</h1>
            {context && (
              <span className="rounded-full border border-[color:var(--ui-border)] bg-[var(--ui-surface-muted)] px-2.5 py-0.5 ui-caption font-semibold text-[var(--ui-text)]">
                {context}
              </span>
            )}
          </div>
        </div>
        {inlineAction && <div className="flex items-center justify-end">{inlineAction}</div>}
      </div>
    </header>
  );
}
