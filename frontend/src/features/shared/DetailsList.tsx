/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import type { ReactNode } from "react";

import {
  cx,
  uiMutedTextClass,
  uiTitleTextClass,
} from "../../components/ui/styles";

type DetailsListItem = {
  id?: string;
  label: ReactNode;
  value: ReactNode;
  mono?: boolean;
  title?: string;
};

type DetailsListProps = {
  items: readonly DetailsListItem[];
  compact?: boolean;
  columns?: 1 | 2;
  valueAlign?: "start" | "end";
};

export default function DetailsList({
  items,
  compact = false,
  columns = 1,
  valueAlign = "start",
}: DetailsListProps) {
  return (
    <dl
      className={cx(
        "grid min-w-0",
        compact ? "gap-2 ui-caption" : "gap-4",
        columns === 2 ? "sm:grid-cols-2" : undefined,
      )}
    >
      {items.map((item, index) => (
        <div
          key={item.id ?? `${String(item.label)}-${index}`}
          className={cx(
            "grid min-w-0",
            compact
              ? "grid-cols-[minmax(0,9rem)_minmax(0,1fr)] items-start gap-3"
              : "gap-1 text-xs sm:grid-cols-[9rem_minmax(0,1fr)] sm:gap-4",
          )}
        >
          <dt className={cx(compact ? undefined : "font-semibold", uiMutedTextClass)}>
            {item.label}
          </dt>
          <dd
            className={cx(
              "min-w-0 break-words font-semibold",
              item.mono ? "font-mono" : uiTitleTextClass,
              valueAlign === "end" ? "text-right" : undefined,
            )}
            title={item.title}
          >
            {item.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}
