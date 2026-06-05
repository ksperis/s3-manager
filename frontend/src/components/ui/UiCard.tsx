/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { ReactNode } from "react";
import {
  cx,
  uiCardClass,
  uiCardMutedClass,
  uiMutedTextClass,
  uiSectionHeaderClass,
  uiTitleTextClass,
} from "./styles";

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
        <header className={cx("flex flex-wrap items-start justify-between gap-3", uiSectionHeaderClass)}>
          <div className="min-w-0">
            {title && <h3 className={cx("ui-subtitle", uiTitleTextClass)}>{title}</h3>}
            {description && <p className={cx("mt-1 ui-caption", uiMutedTextClass)}>{description}</p>}
          </div>
          {actions ? <div className="shrink-0">{actions}</div> : null}
        </header>
      )}
      <div className={cx("px-4 py-3", bodyClassName)}>{children}</div>
    </section>
  );
}
