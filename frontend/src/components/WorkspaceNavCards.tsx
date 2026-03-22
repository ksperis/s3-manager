/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { Link } from "react-router-dom";
import { cx, uiCardClass } from "./ui/styles";

export type WorkspaceNavCardItem = {
  title: string;
  description: string;
  to: string;
  eyebrow?: string;
};

type WorkspaceNavCardsProps = {
  items: WorkspaceNavCardItem[];
  columns?: 2 | 3 | 4;
  className?: string;
};

export default function WorkspaceNavCards({
  items,
  columns = 3,
  className,
}: WorkspaceNavCardsProps) {
  const gridClass = columns === 4 ? "xl:grid-cols-4" : columns === 2 ? "lg:grid-cols-2" : "xl:grid-cols-3";

  return (
    <div className={cx("grid gap-4 sm:grid-cols-2", gridClass, className)}>
      {items.map((item) => (
        <Link
          key={item.to}
          to={item.to}
          className={cx(
            uiCardClass,
            "group flex h-full flex-col justify-between gap-4 px-4 py-4 transition duration-150 hover:-translate-y-[1px] hover:border-primary-300 hover:shadow-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary dark:hover:border-primary-700/60"
          )}
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="ui-caption font-semibold uppercase tracking-wide text-primary">
                {item.eyebrow ?? "Navigation"}
              </p>
              <h3 className="mt-1.5 ui-subtitle font-semibold text-slate-900 dark:text-slate-50">
                {item.title}
              </h3>
            </div>
            <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-slate-200/80 bg-slate-50 text-slate-500 transition group-hover:border-primary-200 group-hover:bg-primary-50 group-hover:text-primary-700 dark:border-slate-700 dark:bg-slate-900/70 dark:text-slate-300 dark:group-hover:border-primary-700 dark:group-hover:bg-primary-950/40 dark:group-hover:text-primary-200">
              <ArrowIcon className="h-4 w-4" />
            </span>
          </div>
          <p className="ui-body text-slate-600 dark:text-slate-300">{item.description}</p>
        </Link>
      ))}
    </div>
  );
}

function ArrowIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" {...props}>
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.7} d="M6 10h8m0 0-3-3m3 3-3 3" />
    </svg>
  );
}
