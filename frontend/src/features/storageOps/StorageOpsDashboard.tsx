/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { Link } from "react-router-dom";
import PageHeader from "../../components/PageHeader";
import { cx, uiCardClass } from "../../components/ui/styles";

const cards = [
  {
    title: "Buckets",
    description: "Cross-account and cross-connection bucket listing, filtering and bulk operations.",
    to: "/storage-ops/buckets",
  },
];

export default function StorageOpsDashboard() {
  return (
    <div className="space-y-4">
      <PageHeader
        title="Storage Ops"
        description="Operations workspace for advanced S3 bucket administration across your authorized contexts."
        breadcrumbs={[{ label: "Storage Ops" }]}
      />
      <div className="grid gap-4 md:grid-cols-3">
        {cards.map((card) => (
          <Link
            key={card.to}
            to={card.to}
            className={cx(
              "group px-3 py-3 transition hover:-translate-y-[1px] hover:shadow-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary",
              uiCardClass
            )}
          >
            <p className="ui-caption font-medium text-slate-500 dark:text-slate-400">Navigation</p>
            <div className="mt-1.5 ui-title font-semibold text-slate-900 dark:text-white">
              {card.title}
            </div>
            <div className="mt-1 ui-caption text-slate-500 dark:text-slate-400">{card.description}</div>
          </Link>
        ))}
      </div>
    </div>
  );
}
