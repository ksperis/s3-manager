/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { cx, uiButtonBaseClass, uiButtonVariants, uiDividerClass, uiLabelClass, uiMutedTextClass } from "./ui/styles";
import { toolbarCompactSelectClasses } from "./toolbarControlClasses";

type PaginationControlsProps = {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
  onPageSizeChange?: (size: number) => void;
  pageSizeOptions?: number[];
  disabled?: boolean;
};

export default function PaginationControls({
  page,
  pageSize,
  total,
  onPageChange,
  onPageSizeChange,
  pageSizeOptions = [10, 25, 50, 100],
  disabled = false,
}: PaginationControlsProps) {
  const totalPages = Math.max(1, Math.ceil(total / (pageSize || 1)));
  const safePage = Math.min(Math.max(page, 1), totalPages);
  const canPrev = safePage > 1;
  const canNext = safePage < totalPages;
  const buttonClassName = cx(uiButtonBaseClass, uiButtonVariants.secondary, "rounded-md px-2.5 py-1 ui-caption");

  return (
    <div className={cx("flex flex-col gap-2 border-t px-4 py-2 ui-caption md:flex-row md:items-center md:justify-between", uiDividerClass, uiMutedTextClass)}>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => onPageChange(safePage - 1)}
          disabled={!canPrev || disabled}
          className={buttonClassName}
        >
          Previous
        </button>
        <button
          type="button"
          onClick={() => onPageChange(safePage + 1)}
          disabled={!canNext || disabled}
          className={buttonClassName}
        >
          Next
        </button>
        <span className={cx("ui-caption", uiMutedTextClass)}>
          Page {safePage} of {totalPages} · {total} result{total === 1 ? "" : "s"}
        </span>
      </div>
      {onPageSizeChange && (
        <label className={cx("flex items-center gap-2", uiLabelClass)}>
          Page size
          <select
            className={cx(toolbarCompactSelectClasses, "px-2 py-1 font-semibold")}
            value={pageSize}
            onChange={(e) => onPageSizeChange(Number(e.target.value))}
            disabled={disabled}
          >
            {pageSizeOptions.map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </select>
        </label>
      )}
    </div>
  );
}
