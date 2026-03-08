/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import type { ReactNode } from "react";
import { cx } from "./ui/styles";

type TableEmptyStateTone = "neutral" | "error";

type TableEmptyStateProps = {
  colSpan?: number;
  message?: ReactNode;
  title?: ReactNode;
  description?: ReactNode;
  tone?: TableEmptyStateTone;
  ariaLive?: "polite" | "assertive";
  className?: string;
};

const toneClasses: Record<TableEmptyStateTone, string> = {
  neutral: "text-slate-500 dark:text-slate-300",
  error: "text-rose-600 dark:text-rose-200",
};

export default function TableEmptyState({
  colSpan = 1,
  message,
  title,
  description,
  tone = "neutral",
  ariaLive = "polite",
  className,
}: TableEmptyStateProps) {
  const content =
    message ??
    (title || description ? (
      <div className="space-y-1">
        {title ? <p className="ui-body font-semibold">{title}</p> : null}
        {description ? <p className="ui-caption">{description}</p> : null}
      </div>
    ) : (
      "No data available."
    ));

  return (
    <tr>
      <td
        colSpan={colSpan}
        aria-live={ariaLive}
        className={cx("px-4 py-3 ui-caption", toneClasses[tone], className)}
      >
        {content}
      </td>
    </tr>
  );
}
