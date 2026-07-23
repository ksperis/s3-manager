/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { ReactNode } from "react";
import { Link, useInRouterContext } from "react-router-dom";
import { cx, uiButtonBaseClass, uiButtonVariants, uiMutedTextClass, uiTitleTextClass } from "./ui/styles";

export type PageBreadcrumb = { label: string; to?: string; onClick?: () => void };
type Action = {
  label: string;
  onClick?: () => void;
  to?: string;
  variant?: "primary" | "secondary" | "ghost" | "danger" | "neutral";
  disabled?: boolean;
};

export type PageHeaderProps = {
  title: string;
  description?: ReactNode;
  breadcrumbs?: PageBreadcrumb[];
  actions?: Action[];
  inlineContent?: ReactNode;
  metaContent?: ReactNode;
  rightContent?: ReactNode;
};

export default function PageHeader({
  title,
  description,
  breadcrumbs = [],
  actions = [],
  inlineContent,
  metaContent,
  rightContent,
}: PageHeaderProps) {
  const inRouterContext = useInRouterContext();
  const renderActions = () =>
    actions.map((action) => {
      const classes =
        action.variant === "danger"
          ? uiButtonVariants.danger
          : action.variant === "secondary"
            ? uiButtonVariants.secondary
            : action.variant === "ghost"
              ? uiButtonVariants.ghost
              : action.variant === "neutral"
                ? uiButtonVariants.neutral
                : uiButtonVariants.primary;
      const base = cx(uiButtonBaseClass, "h-8 px-3 py-1.5 text-xs", action.disabled && "pointer-events-none opacity-60");
      if (action.to) {
        return (
          <Link
            key={action.label}
            to={action.to}
            aria-disabled={action.disabled ? true : undefined}
            tabIndex={action.disabled ? -1 : undefined}
            className={cx(base, classes)}
          >
            {action.label}
          </Link>
        );
      }
      return (
        <button
          key={action.label}
          onClick={action.onClick}
          className={cx(base, classes)}
          type="button"
          disabled={action.disabled}
        >
          {action.label}
        </button>
      );
    });

  return (
    <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0">
        {breadcrumbs.length > 0 && (
          <nav
            aria-label="Breadcrumb"
            className={cx("mb-1 flex flex-wrap items-center gap-1.5 text-[11px] font-semibold leading-4", uiMutedTextClass)}
          >
            {breadcrumbs.map((bc, idx) => (
              <span key={`${bc.label}-${idx}`} className="flex items-center gap-1.5">
                {bc.to && inRouterContext ? (
                  <Link
                    to={bc.to}
                    onClick={bc.onClick}
                    className="transition hover:text-primary-700 dark:hover:text-primary-200"
                  >
                    {bc.label}
                  </Link>
                ) : bc.to ? (
                  <a
                    href={bc.to}
                    onClick={bc.onClick}
                    className="transition hover:text-primary-700 dark:hover:text-primary-200"
                  >
                    {bc.label}
                  </a>
                ) : (
                  <span aria-current={idx === breadcrumbs.length - 1 ? "page" : undefined}>{bc.label}</span>
                )}
                {idx < breadcrumbs.length - 1 && <span className="opacity-55">/</span>}
              </span>
            ))}
          </nav>
        )}
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <h1 className={cx("text-[17px] font-bold leading-6", uiTitleTextClass)}>{title}</h1>
          {inlineContent ? <div className="flex flex-wrap items-center gap-2">{inlineContent}</div> : null}
        </div>
        {description ? <p className={cx("mt-1 max-w-3xl text-xs leading-5", uiMutedTextClass)}>{description}</p> : null}
        {metaContent ? <div className="mt-2 min-w-0">{metaContent}</div> : null}
      </div>
      {rightContent || actions.length > 0 ? (
        <div
          className={cx(
            "flex w-full flex-wrap items-center gap-2 sm:w-auto sm:justify-end",
            breadcrumbs.length > 0 && "sm:pt-6"
          )}
        >
          {rightContent}
          {renderActions()}
        </div>
      ) : null}
    </header>
  );
}
