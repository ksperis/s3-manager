/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { ReactNode } from "react";
import { Link } from "react-router-dom";

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
    <div className="flex flex-col gap-4 rounded-2xl border border-slate-200/70 bg-white/90 px-5 py-4 shadow-sm dark:border-slate-800 dark:bg-slate-900/70">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="space-y-2">
          {breadcrumbs.length > 0 && (
            <nav className="flex flex-wrap items-center gap-2 text-xs font-medium text-slate-500 dark:text-slate-400">
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
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-semibold text-slate-900 dark:text-white">{title}</h1>
            {inlineContent}
          </div>
          {description && <p className="text-sm text-slate-600 dark:text-slate-300">{description}</p>}
        </div>
        {rightContent ? (
          <div className="flex flex-wrap items-center gap-2">{rightContent}</div>
        ) : actions.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {actions.map((action) => {
              const classes =
                action.variant === "danger"
                  ? "bg-rose-600 text-white hover:bg-rose-700"
                  : action.variant === "ghost"
                    ? "border border-slate-200 text-slate-700 hover:border-primary hover:text-primary dark:border-slate-700 dark:text-slate-200 dark:hover:border-primary-500 dark:hover:text-primary-200"
                    : "bg-primary text-white hover:bg-primary-600";
              const base =
                "inline-flex items-center justify-center rounded-lg px-4 py-2 text-sm font-semibold shadow-sm transition";
              if (action.to) {
                return (
                  <Link key={action.label} to={action.to} className={`${base} ${classes}`}>
                    {action.label}
                  </Link>
                );
              }
              return (
                <button key={action.label} onClick={action.onClick} className={`${base} ${classes}`} type="button">
                  {action.label}
                </button>
              );
            })}
          </div>
        ) : null}
      </div>
    </div>
  );
}
