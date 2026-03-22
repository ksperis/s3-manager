/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { cx, uiButtonBaseClass, uiButtonVariants, uiCardClass, type UiTone, uiToneBadgeClasses } from "./ui/styles";

type PageEmptyStateAction = {
  label: string;
  to?: string;
  onClick?: () => void;
  variant?: "primary" | "secondary" | "ghost";
};

type PageEmptyStateProps = {
  title: string;
  description: ReactNode;
  eyebrow?: string;
  tone?: UiTone;
  primaryAction?: PageEmptyStateAction;
  secondaryAction?: PageEmptyStateAction;
  children?: ReactNode;
  className?: string;
};

function renderAction(action: PageEmptyStateAction) {
  const variant = action.variant ?? "primary";
  const classes = cx(uiButtonBaseClass, uiButtonVariants[variant], "rounded-lg px-4 py-2");
  if (action.to) {
    return (
      <Link key={action.label} to={action.to} className={classes}>
        {action.label}
      </Link>
    );
  }
  return (
    <button key={action.label} type="button" onClick={action.onClick} className={classes}>
      {action.label}
    </button>
  );
}

export default function PageEmptyState({
  title,
  description,
  eyebrow = "Next step",
  tone = "neutral",
  primaryAction,
  secondaryAction,
  children,
  className,
}: PageEmptyStateProps) {
  return (
    <section className={cx(uiCardClass, "border-dashed px-6 py-8", className)}>
      <div className="mx-auto max-w-3xl text-center">
        <span
          className={cx(
            "inline-flex items-center rounded-full border px-2.5 py-1 ui-caption font-semibold uppercase tracking-wide",
            uiToneBadgeClasses[tone]
          )}
        >
          {eyebrow}
        </span>
        <h2 className="mt-4 ui-title font-semibold text-slate-900 dark:text-slate-50">{title}</h2>
        <p className="mt-2 ui-body text-slate-600 dark:text-slate-300">{description}</p>
        {children ? <div className="mt-4">{children}</div> : null}
        {primaryAction || secondaryAction ? (
          <div className="mt-5 flex flex-wrap items-center justify-center gap-3">
            {primaryAction ? renderAction(primaryAction) : null}
            {secondaryAction ? renderAction({ ...secondaryAction, variant: secondaryAction.variant ?? "ghost" }) : null}
          </div>
        ) : null}
      </div>
    </section>
  );
}
