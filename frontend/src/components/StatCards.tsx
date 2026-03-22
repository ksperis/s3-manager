/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { Link } from "react-router-dom";
import { cx, uiCardClass } from "./ui/styles";

type Stat = {
  label: string;
  value: string | number;
  hint?: string;
  to?: string;
};

type StatCardsProps = {
  stats: Stat[];
  columns?: 2 | 3 | 4;
};

export default function StatCards({ stats, columns = 3 }: StatCardsProps) {
  const grid = columns === 4 ? "lg:grid-cols-4" : columns === 2 ? "lg:grid-cols-2" : "lg:grid-cols-3";
  const baseClasses = cx(uiCardClass, "flex h-full flex-col gap-2 px-4 py-4 transition hover:-translate-y-[1px] hover:shadow-md");

  return (
    <div className={`grid gap-4 sm:grid-cols-2 ${grid}`}>
      {stats.map((item) => {
        const content = (
          <>
            <p className="ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">{item.label}</p>
            <p className="mt-1.5 ui-title font-semibold text-slate-900 dark:text-white">{item.value}</p>
            {item.hint && <p className="mt-1 ui-caption text-slate-500 dark:text-slate-400">{item.hint}</p>}
          </>
        );

        if (item.to) {
          return (
            <Link
              key={item.label}
              to={item.to}
              className={`${baseClasses} focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary`}
            >
              {content}
            </Link>
          );
        }

        return (
          <div key={item.label} className={baseClasses}>
            {content}
          </div>
        );
      })}
    </div>
  );
}
