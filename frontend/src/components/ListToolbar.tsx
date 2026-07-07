/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import type { ReactNode } from "react";
import {
  cx,
  uiMutedTextClass,
  uiTitleTextClass,
  uiToolbarClass,
  uiToolbarSecondaryClass,
} from "./ui/styles";

type ListToolbarProps = {
  title: ReactNode;
  description?: ReactNode;
  showHeading?: boolean;
  countLabel?: ReactNode;
  search?: ReactNode;
  filters?: ReactNode;
  columns?: ReactNode;
  actions?: ReactNode;
  secondaryContent?: ReactNode;
  className?: string;
};

function ToolbarControlGroup({ children }: { children: ReactNode }) {
  if (!children) {
    return null;
  }
  return <div className="flex min-w-0 flex-wrap items-center gap-2 max-sm:w-full">{children}</div>;
}

export default function ListToolbar({
  title,
  description,
  showHeading = true,
  countLabel,
  search,
  filters,
  columns,
  actions,
  secondaryContent,
  className,
}: ListToolbarProps) {
  const accessibleLabel = typeof title === "string" ? title : undefined;

  return (
    <div
      className={cx(uiToolbarClass, className)}
      role={!showHeading && accessibleLabel ? "region" : undefined}
      aria-label={!showHeading ? accessibleLabel : undefined}
    >
      <div className={cx("flex flex-col gap-3 px-4", showHeading ? "py-4" : "py-3")}>
        <div
          className={cx(
            "flex flex-col gap-3",
            showHeading ? "lg:flex-row lg:items-start lg:justify-between" : "lg:flex-row lg:items-center lg:justify-between"
          )}
        >
          {showHeading ? (
            <div className="space-y-1">
              <p className={cx("ui-body", uiTitleTextClass)}>{title}</p>
              {description ? <p className={cx("ui-caption", uiMutedTextClass)}>{description}</p> : null}
            </div>
          ) : null}
          <div
            className={cx(
              "flex flex-wrap items-center gap-2",
              showHeading ? "lg:justify-end" : "min-w-0 flex-1 justify-between"
            )}
          >
            {countLabel ? <span className={cx("shrink-0 ui-caption", uiMutedTextClass)}>{countLabel}</span> : null}
            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2 max-sm:w-full lg:justify-end">
              <ToolbarControlGroup>{search}</ToolbarControlGroup>
              <ToolbarControlGroup>{filters}</ToolbarControlGroup>
              <ToolbarControlGroup>{columns}</ToolbarControlGroup>
              <ToolbarControlGroup>{actions}</ToolbarControlGroup>
            </div>
          </div>
        </div>
      </div>
      {secondaryContent ? (
        <div className={uiToolbarSecondaryClass}>
          {secondaryContent}
        </div>
      ) : null}
    </div>
  );
}
