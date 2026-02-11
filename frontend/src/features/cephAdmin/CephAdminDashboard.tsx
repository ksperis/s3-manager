/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { Link } from "react-router-dom";
import PageHeader from "../../components/PageHeader";
import { useCephAdminEndpoint } from "./CephAdminEndpointContext";

type CardLink = {
  title: string;
  description: string;
  to: string;
};

const cards: CardLink[] = [
  { title: "Metrics", description: "Cluster-wide view of RGW storage and traffic.", to: "/ceph-admin/metrics" },
  { title: "RGW Accounts", description: "Create/import RGW tenants and manage their quotas.", to: "/ceph-admin/accounts" },
  { title: "RGW Users", description: "Manage cluster-wide RGW users.", to: "/ceph-admin/users" },
  { title: "Buckets", description: "List and configure cluster-wide buckets (Admin Ops + S3).", to: "/ceph-admin/buckets" },
];

export default function CephAdminDashboard() {
  const { selectedEndpoint } = useCephAdminEndpoint();
  return (
    <div className="space-y-4">
      <PageHeader
        title="Ceph Admin"
        description={`Cluster-level RGW administration. Active endpoint: ${selectedEndpoint?.name ?? "—"}.`}
        breadcrumbs={[{ label: "Ceph Admin" }]}
      />
      <div className="grid gap-4 md:grid-cols-3">
        {cards.map((card) => (
          <Link
            key={card.to}
            to={card.to}
            className="group rounded-xl border border-slate-200/80 bg-white px-3 py-3 shadow-sm transition hover:-translate-y-[1px] hover:shadow-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary dark:border-slate-800 dark:bg-slate-900"
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
