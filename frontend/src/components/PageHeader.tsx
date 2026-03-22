/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { ReactNode } from "react";
import { Link } from "react-router-dom";
import { cx, uiButtonBaseClass, uiButtonVariants, uiCardClass } from "./ui/styles";

type Breadcrumb = { label: string; to?: string };
type Action = {
  label: string;
  onClick?: () => void;
  to?: string;
  variant?: "primary" | "ghost" | "danger";
};

type PageHeaderProps = {
  title: string;
  description?: string;
  breadcrumbs?: Breadcrumb[];
  actions?: Action[];
  inlineContent?: ReactNode;
  rightContent?: ReactNode;
};

export default function PageHeader({
  title,
  description,
  breadcrumbs = [],
  actions = [],
  inlineContent,
  rightContent,
}: PageHeaderProps) {
  return (
    <header
      className={cx(
        uiCardClass,
        "overflow-hidden bg-gradient-to-r from-white via-white to-slate-50/80 px-4 py-4 dark:from-slate-900 dark:via-slate-900 dark:to-slate-800/70"
      )}
    >
      <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <div className="min-w-0 space-y-3">
          {breadcrumbs.length > 0 && (
            <nav className="flex flex-wrap items-center gap-2 ui-caption font-medium text-slate-500 dark:text-slate-400">
              {breadcrumbs.map((bc, idx) => (
                <span key={bc.label} className="flex items-center gap-2">
                  {bc.to ? (
                    <Link to={bc.to} className="hover:text-primary-700 dark:hover:text-primary-200">
                      {bc.label}
                    </Link>
                  ) : (
                    <span>{bc.label}</span>
                  )}
                  {idx < breadcrumbs.length - 1 && <span className="text-slate-400 dark:text-slate-600">/</span>}
                </span>
              ))}
            </nav>
          )}
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="ui-title font-semibold text-slate-900 dark:text-white">{title}</h1>
              {inlineContent ? <div className="flex flex-wrap items-center gap-2">{inlineContent}</div> : null}
            </div>
            {description ? (
              <p className="max-w-3xl ui-body text-slate-600 dark:text-slate-300">{description}</p>
            ) : null}
          </div>
        </div>
        {rightContent ? (
          <div className="flex w-full flex-wrap items-center gap-2 xl:w-auto xl:justify-end">{rightContent}</div>
        ) : actions.length > 0 ? (
          <div className="flex w-full flex-wrap gap-2 xl:w-auto xl:justify-end">
            {actions.map((action) => {
              const classes =
                action.variant === "danger"
                  ? uiButtonVariants.danger
                  : action.variant === "ghost"
                    ? uiButtonVariants.ghost
                    : uiButtonVariants.primary;
              const base = cx(uiButtonBaseClass, "py-1.5");
              if (action.to) {
                return (
                  <Link key={action.label} to={action.to} className={cx(base, classes)}>
                    {action.label}
                  </Link>
                );
              }
              return (
                <button key={action.label} onClick={action.onClick} className={cx(base, classes)} type="button">
                  {action.label}
                </button>
              );
            })}
          </div>
        ) : null}
      </div>
    </header>
  );
}
