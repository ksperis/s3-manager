/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { ReactNode } from "react";
import PageBanner from "./PageBanner";
import { cx } from "./ui/styles";

type MetricsUnavailableCardProps = {
  eyebrow: string;
  title: string;
  description: string;
  message: ReactNode;
  tone?: "info" | "warning" | "error";
  className?: string;
};

export default function MetricsUnavailableCard({
  eyebrow,
  title,
  description,
  message,
  tone = "info",
  className,
}: MetricsUnavailableCardProps) {
  return (
    <section className={cx("space-y-4 ui-surface-card p-5", className)}>
      <header className="space-y-1">
        <p className="ui-caption font-semibold uppercase tracking-wide text-primary">{eyebrow}</p>
        <h3 className="ui-section font-semibold text-slate-900 dark:text-slate-100">{title}</h3>
        <p className="ui-body text-slate-500 dark:text-slate-400">{description}</p>
      </header>
      <PageBanner tone={tone}>{message}</PageBanner>
    </section>
  );
}
