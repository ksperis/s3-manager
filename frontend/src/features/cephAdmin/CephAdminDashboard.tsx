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
  { title: "RGW Accounts", description: "Créer/importer des tenants RGW et gérer leurs quotas.", to: "/ceph-admin/accounts" },
  { title: "RGW Users", description: "Administrer les utilisateurs RGW du cluster.", to: "/ceph-admin/users" },
  { title: "Buckets", description: "Lister et configurer les buckets du cluster (Admin Ops + S3).", to: "/ceph-admin/buckets" },
];

export default function CephAdminDashboard() {
  const { selectedEndpoint } = useCephAdminEndpoint();
  return (
    <div className="space-y-4">
      <PageHeader
        title="Ceph Admin"
        description={`Administration RGW cluster-level. Endpoint actif : ${selectedEndpoint?.name ?? "—"}.`}
        breadcrumbs={[{ label: "Ceph Admin" }]}
      />
      <div className="grid gap-4 md:grid-cols-3">
        {cards.map((card) => (
          <Link
            key={card.to}
            to={card.to}
            className="group rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm transition hover:border-primary-300 hover:shadow-md dark:border-slate-800 dark:bg-slate-900 dark:hover:border-primary-600"
          >
            <div className="ui-subtitle font-semibold text-slate-900 group-hover:text-primary-700 dark:text-slate-50 dark:group-hover:text-primary-200">
              {card.title}
            </div>
            <div className="mt-1 ui-body text-slate-600 dark:text-slate-300">{card.description}</div>
          </Link>
        ))}
      </div>
    </div>
  );
}
