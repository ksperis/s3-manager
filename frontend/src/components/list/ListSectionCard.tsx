/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import type { ReactNode } from "react";
import {
  cx,
  uiCardClass,
  uiMutedTextClass,
  uiSectionHeaderLargeClass,
  uiTitleTextClass,
} from "../ui/styles";

type ListSectionCardProps = {
  title: ReactNode;
  subtitle?: ReactNode;
  rightContent?: ReactNode;
  afterHeader?: ReactNode;
  children: ReactNode;
  className?: string;
};

export default function ListSectionCard({
  title,
  subtitle,
  rightContent,
  afterHeader,
  children,
  className,
}: ListSectionCardProps) {
  return (
    <div className={cx(uiCardClass, className)}>
      <div className={uiSectionHeaderLargeClass}>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className={cx("ui-body", uiTitleTextClass)}>{title}</p>
            {subtitle ? <p className={cx("ui-caption", uiMutedTextClass)}>{subtitle}</p> : null}
          </div>
          {rightContent ? <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-end">{rightContent}</div> : null}
        </div>
      </div>
      {afterHeader}
      {children}
    </div>
  );
}
