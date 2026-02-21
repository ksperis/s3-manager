/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { ReactNode } from "react";
import { cx, uiCardClass, uiCardMutedClass } from "./styles";

type UiCardProps = {
  title?: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
  muted?: boolean;
};

export default function UiCard({
  title,
  description,
  actions,
  children,
  className,
  bodyClassName,
  muted = false,
}: UiCardProps) {
  return (
    <section className={cx(muted ? uiCardMutedClass : uiCardClass, className)}>
      {(title || description || actions) && (
        <header className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-200/80 px-4 py-3 dark:border-slate-800">
          <div className="min-w-0">
            {title && <h3 className="ui-subtitle font-semibold text-slate-900 dark:text-slate-50">{title}</h3>}
            {description && <p className="mt-1 ui-caption text-slate-500 dark:text-slate-400">{description}</p>}
          </div>
          {actions ? <div className="shrink-0">{actions}</div> : null}
        </header>
      )}
      <div className={cx("px-4 py-3", bodyClassName)}>{children}</div>
    </section>
  );
}

