/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
type Stat = { label: string; value: string | number };

type DashboardProps = {
  title: string;
  description: string;
  stats?: Stat[];
};

const defaultStats: Stat[] = [
  { label: "Buckets", value: 12 },
  { label: "Objects", value: "24.1k" },
  { label: "Total size", value: "4.3 TB" },
  { label: "S3Accounts", value: 5 },
];

export default function Dashboard({ title, description, stats = defaultStats }: DashboardProps) {
  return (
    <div className="space-y-4">
      <h2 className="ui-title font-semibold text-slate-800">{title}</h2>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map((item) => (
          <div key={item.label} className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
            <p className="ui-body text-slate-500">{item.label}</p>
            <p className="mt-2 ui-metric font-semibold text-slate-900">{item.value}</p>
          </div>
        ))}
      </div>
      <div className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <h3 className="ui-subtitle font-semibold text-slate-800">Usage overview</h3>
        <p className="mt-2 ui-body text-slate-600">{description}</p>
      </div>
    </div>
  );
}
