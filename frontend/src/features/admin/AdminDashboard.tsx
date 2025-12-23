/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useEffect, useMemo, useState } from "react";
import { AdminSummary, fetchAdminSummary } from "../../api/stats";
import PageHeader from "../../components/PageHeader";
import StatCards from "../../components/StatCards";

export default function AdminDashboard() {
  const [summary, setSummary] = useState<AdminSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      try {
        const data = await fetchAdminSummary();
        setSummary(data);
        setError(null);
      } catch (err) {
        setError("Unable to load admin overview.");
      }
    };
    load();
  }, []);

  const cards = useMemo(
    () =>
      summary
        ? [
            {
              label: "UI users",
              value: (summary.total_users ?? 0) + (summary.total_admins ?? 0) + (summary.total_portal_users ?? 0),
              hint: `Admins: ${summary.total_admins ?? 0} | Managers: ${summary.total_users ?? 0} | Portail: ${summary.total_portal_users ?? 0}`,
              to: "/admin/users",
            },
            { label: "Accounts", value: summary.total_accounts, to: "/admin/s3-accounts" },
            { label: "S3 users", value: summary.total_s3_users ?? 0, to: "/admin/s3-users" },
          ]
        : [],
    [summary]
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Admin overview"
        description={error || "Global Ceph RGW view (Endpoints, UI Users, Storage Accounts)."}
        breadcrumbs={[{ label: "Admin" }, { label: "Dashboard" }]}
      />

      <StatCards stats={cards} columns={3} />
    </div>
  );
}
